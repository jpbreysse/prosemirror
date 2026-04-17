/**
 * GraphBuilderNodeView
 *
 * A fully interactive visual graph editor embedded in a ProseMirror document.
 *
 * Three interaction modes (toolbar):
 *   ↖ Select  — click to select nodes/edges, drag nodes to reposition
 *   ✚ Add     — click anywhere on the canvas to place a new node
 *   ↔ Connect — click source node then target node to draw an edge
 *
 * Bottom panel context:
 *   Nothing selected  → stats (N nodes · M edges)
 *   Node selected     → rename input + colour picker + delete
 *   Edge selected     → rename label input + delete
 *   Connect mode      → breadcrumb showing source, cancel button
 *
 * All graph data (nodes[], edges[], directed, title) is stored in ProseMirror
 * node attrs and persisted to Postgres with the rest of the document.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const W = 860, H = 420;   // SVG viewBox size
const R = 30;             // node circle radius
const ARROW_GAP = 10;     // extra gap before arrowhead tip

const PALETTE = [
  '#6366f1','#059669','#d97706','#dc2626',
  '#0284c7','#7c3aed','#0f766e','#b45309',
  '#0891b2','#9333ea','#65a30d','#ea580c',
];

let _gbCounter = 0;

// ── NodeView ──────────────────────────────────────────────────────────────────

export class GraphBuilderNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._uid   = `gb${++_gbCounter}`;

    // UI state — not stored in ProseMirror
    this._mode    = 'select';  // 'select' | 'add' | 'connect'
    this._sel     = null;      // selected id
    this._selType = null;      // 'node' | 'edge'
    this._src     = null;      // connect-mode source node id
    this._drag    = null;      // { id, startX, startY, nodeX, nodeY, _nx, _ny }

    this.dom = document.createElement('div');
    this.dom.className = 'gb-block';
    this._build();
  }

  // ── Patch helper ─────────────────────────────────────────────────────────────

  _patch(fn) {
    const { state, dispatch } = this.view;
    const cur  = this.node.attrs;
    const next = typeof fn === 'function' ? { ...cur, ...fn(cur) } : { ...cur, ...fn };
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, next));
  }

  // ── Full rebuild ──────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = '';
    this._buildToolbar();
    this._buildCanvas();
    this._buildPanel();
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────────

  _buildToolbar() {
    const { title = '', directed = true } = this.node.attrs;
    const bar = document.createElement('div');
    bar.className = 'gb-toolbar';

    bar.innerHTML = `
      <div class="gb-toolbar-left">
        <svg class="gb-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="4"  cy="9"  r="3.2" stroke="#6366f1" stroke-width="1.4"/>
          <circle cx="14" cy="4"  r="3.2" stroke="#059669" stroke-width="1.4"/>
          <circle cx="14" cy="14" r="3.2" stroke="#d97706" stroke-width="1.4"/>
          <line x1="7" y1="8"  x2="11" y2="5"  stroke="#94a3b8" stroke-width="1.2"/>
          <line x1="7" y1="10" x2="11" y2="13" stroke="#94a3b8" stroke-width="1.2"/>
        </svg>
        <input class="gb-title-input" type="text" value="${ea(title)}" placeholder="Graph title…" spellcheck="false"/>
      </div>

      <div class="gb-mode-btns" role="group">
        <button class="gb-mode-btn ${this._mode==='select'  ? 'gb-mode-btn--on':''}" data-mode="select"  title="Select &amp; move nodes">↖ Select</button>
        <button class="gb-mode-btn ${this._mode==='add'     ? 'gb-mode-btn--on':''}" data-mode="add"     title="Click canvas to add a node">✚ Add</button>
        <button class="gb-mode-btn ${this._mode==='connect' ? 'gb-mode-btn--on':''}" data-mode="connect" title="Click two nodes to draw an edge">↔ Connect</button>
      </div>

      <div class="gb-toolbar-right">
        <label class="gb-directed-lbl" title="Toggle directed / undirected">
          <input type="checkbox" class="gb-directed-cb" ${directed ? 'checked' : ''}/>
          Directed
        </label>
        <button class="gb-del-sel-btn" title="Delete selected node or edge" ${this._sel ? '' : 'disabled'}>🗑 Delete</button>
        <button class="gb-clear-btn"   title="Remove all nodes and edges">✕ Clear</button>
      </div>`;

    // Title
    const titleInp = bar.querySelector('.gb-title-input');
    titleInp.addEventListener('blur',    () => this._patch({ title: titleInp.value }));
    titleInp.addEventListener('keydown', e => { if (e.key === 'Enter') titleInp.blur(); });

    // Mode buttons
    bar.querySelectorAll('.gb-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._mode = btn.dataset.mode;
        this._src  = null;
        bar.querySelectorAll('.gb-mode-btn').forEach(b =>
          b.classList.toggle('gb-mode-btn--on', b.dataset.mode === this._mode)
        );
        if (this._svg) this._svg.style.cursor = this._cursor();
        this._updatePanel();
      });
    });

    // Directed toggle
    bar.querySelector('.gb-directed-cb').addEventListener('change', e => {
      this._patch({ directed: e.target.checked });
    });

    // Delete selected
    bar.querySelector('.gb-del-sel-btn').addEventListener('click', () => {
      if (!this._sel) return;
      if (this._selType === 'node') this._deleteNode(this._sel);
      else                          this._deleteEdge(this._sel);
    });

    // Clear
    bar.querySelector('.gb-clear-btn').addEventListener('click', () => {
      if (!confirm('Remove all nodes and edges?')) return;
      this._sel = null; this._selType = null; this._src = null;
      this._patch({ nodes: [], edges: [], nextId: 1, nextEdgeId: 1 });
    });

    this._toolbar = bar;
    this.dom.appendChild(bar);
  }

  // ── SVG Canvas ────────────────────────────────────────────────────────────────

  _buildCanvas() {
    const wrap = document.createElement('div');
    wrap.className = 'gb-canvas-wrap';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width',  '100%');
    svg.style.display   = 'block';
    svg.style.minWidth  = '500px';
    svg.style.cursor    = this._cursor();
    this._svg = svg;

    // Z-order layers
    this._edgesLayer = this._svgG(svg, 'gb-edges-layer');
    this._nodesLayer = this._svgG(svg, 'gb-nodes-layer');

    // Transparent background — captures add/deselect clicks
    const bg = this._svgEl('rect', { x:0, y:0, width:W, height:H, fill:'transparent' });
    bg.addEventListener('click', e => this._onBgClick(e));
    svg.insertBefore(bg, this._edgesLayer); // bg below both layers

    // Arrowhead markers in <defs>
    this._buildDefs(svg);

    // Render graph
    this._renderEdges();
    this._renderNodes();

    // SVG-level pointer events for drag
    svg.addEventListener('mousemove',  e => this._onSvgMove(e));
    svg.addEventListener('mouseup',    e => this._onSvgUp(e));
    svg.addEventListener('mouseleave', () => this._onSvgLeave());

    wrap.appendChild(svg);
    this.dom.appendChild(wrap);
  }

  _buildDefs(svg) {
    svg.querySelector('defs')?.remove();
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    const makeArrow = (id, color) => {
      const m = this._svgEl('marker', {
        id, viewBox:'0 0 10 10', refX:'9', refY:'5',
        markerWidth:'6', markerHeight:'6', orient:'auto',
      });
      const p = this._svgEl('path', {
        d:'M1 1L9 5L1 9', fill:'none', stroke:color,
        'stroke-width':'1.5', 'stroke-linecap':'round', 'stroke-linejoin':'round',
      });
      m.appendChild(p);
      defs.appendChild(m);
    };

    const uid = this._uid;
    const usedColors = [...new Set((this.node.attrs.nodes||[]).map(n => n.color || '#6366f1'))];
    if (!usedColors.length) usedColors.push('#6366f1');
    usedColors.forEach(c => makeArrow(`${uid}-arr-${c.replace('#','')}`, c));
    makeArrow(`${uid}-arr-sel`, '#f59e0b'); // selected edge arrow

    svg.appendChild(defs);
  }

  _renderEdges() {
    const { edges=[], nodes=[], directed=true } = this.node.attrs;
    const uid     = this._uid;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    this._edgesLayer.innerHTML = '';

    for (const edge of edges) {
      const s = nodeMap.get(edge.source);
      const t = nodeMap.get(edge.target);
      if (!s || !t) continue;

      const isSelected = this._sel === edge.id && this._selType === 'edge';
      const stroke     = isSelected ? '#f59e0b' : '#94a3b8';
      const sw         = isSelected ? 2.5 : 1.8;

      const g = this._svgEl('g', { class:'gb-edge', 'data-id': edge.id });
      g.style.cursor = 'pointer';

      if (s.id === t.id) {
        // Self-loop arc above the node
        const d = `M${s.x-12},${s.y-R} C${s.x-55},${s.y-90} ${s.x+55},${s.y-90} ${s.x+12},${s.y-R}`;
        g.appendChild(this._svgEl('path', { d, fill:'none', stroke, 'stroke-width':sw }));
      } else {
        // Check if reverse edge exists → draw curved to avoid overlap
        const hasReverse = edges.some(e => e.source === edge.target && e.target === edge.source);
        const { x1,y1,x2,y2 } = this._edgePts(s, t);

        let pathD;
        if (hasReverse) {
          // Offset the curve perpendicular to the line
          const mx = (x1+x2)/2, my = (y1+y2)/2;
          const dx = x2-x1, dy = y2-y1;
          const len = Math.sqrt(dx*dx+dy*dy) || 1;
          const ox = -dy/len * 40, oy = dx/len * 40; // perpendicular offset
          pathD = `M${x1},${y1} Q${mx+ox},${my+oy} ${x2},${y2}`;
        } else {
          pathD = `M${x1},${y1} L${x2},${y2}`;
        }

        // Wide invisible hit area
        g.appendChild(this._svgEl('path', {
          d: pathD, fill:'none', stroke:'transparent', 'stroke-width':'14',
        }));

        const lineEl = this._svgEl('path', {
          d: pathD, fill:'none', stroke, 'stroke-width':sw,
        });
        if (directed) {
          const srcColor  = (s.color||'#6366f1').replace('#','');
          const markerId  = isSelected ? `${uid}-arr-sel` : `${uid}-arr-${srcColor}`;
          lineEl.setAttribute('marker-end', `url(#${markerId})`);
        }
        g.appendChild(lineEl);

        // Edge label
        if (edge.label) {
          const mx = (x1+x2)/2, my = (y1+y2)/2;
          const lbl = this._svgEl('text', {
            x:mx, y:my-6, 'text-anchor':'middle',
            'font-family':'system-ui,sans-serif', 'font-size':'11',
            fill:'#64748b', 'pointer-events':'none',
          });
          lbl.textContent = edge.label;
          g.appendChild(lbl);
        }
      }

      g.addEventListener('click', e => { e.stopPropagation(); this._selectEdge(edge.id); });
      this._edgesLayer.appendChild(g);
    }
  }

  _renderNodes() {
    const { nodes=[] } = this.node.attrs;
    this._nodesLayer.innerHTML = '';

    for (const node of nodes) {
      const isSelected = this._sel === node.id && this._selType === 'node';
      const isSrc      = this._src === node.id;
      const g = this._svgEl('g', { class:'gb-node', 'data-id': node.id });
      g.style.cursor = this._mode === 'add' ? 'not-allowed' : 'pointer';

      // Animated selection / source ring
      if (isSelected || isSrc) {
        const ring = this._svgEl('circle', {
          cx:node.x, cy:node.y, r:R+6, fill:'none',
          stroke: isSrc ? '#f59e0b' : '#a5b4fc', 'stroke-width':'2',
          'stroke-dasharray':'5 3',
        });
        g.appendChild(ring);
      }

      // Main circle
      g.appendChild(this._svgEl('circle', {
        cx:node.x, cy:node.y, r:R,
        fill: node.color||'#6366f1',
        stroke: isSelected ? '#3730a3' : 'rgba(0,0,0,.12)',
        'stroke-width': isSelected ? '2.5' : '1',
        class:'gb-node-circle',
      }));

      // Label (up to 8 chars in circle)
      const label = (node.label||'').slice(0,8) || node.id.slice(0,4);
      const lbl = this._svgEl('text', {
        x:node.x, y:node.y, 'text-anchor':'middle', 'dominant-baseline':'central',
        'font-family':'system-ui,sans-serif',
        'font-size': label.length > 5 ? '10' : '12',
        'font-weight':'600', fill:'#fff', 'pointer-events':'none',
      });
      lbl.textContent = label;
      g.appendChild(lbl);

      g.addEventListener('mousedown', e => this._onNodeDown(e, node));
      g.addEventListener('click',     e => this._onNodeClick(e, node));
      this._nodesLayer.appendChild(g);
    }
  }

  // ── Panel ─────────────────────────────────────────────────────────────────────

  _buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'gb-panel';
    this._panel = panel;
    this._updatePanel();
    this.dom.appendChild(panel);
  }

  _updatePanel() {
    if (!this._panel) return;

    // ── Add mode ──
    if (this._mode === 'add') {
      this._panel.innerHTML = '<span class="gb-hint">✚ Click anywhere on the canvas to place a new node</span>';
      return;
    }

    // ── Connect mode ──
    if (this._mode === 'connect') {
      if (!this._src) {
        this._panel.innerHTML = '<span class="gb-hint">↔ Click a source node to start drawing an edge</span>';
      } else {
        const srcNode = (this.node.attrs.nodes||[]).find(n => n.id === this._src);
        this._panel.innerHTML = `
          <span class="gb-hint gb-hint--src">
            Edge from <strong>${eh(srcNode?.label || this._src)}</strong>
            — now click the target node
            <button class="gb-cancel-btn">✕ Cancel</button>
          </span>`;
        this._panel.querySelector('.gb-cancel-btn').addEventListener('click', () => {
          this._src = null;
          this._updatePanel();
          this._renderNodes();
        });
      }
      return;
    }

    // ── Select mode — nothing selected ──
    if (!this._sel) {
      const { nodes=[], edges=[] } = this.node.attrs;
      this._panel.innerHTML = `<span class="gb-hint">${nodes.length} node${nodes.length!==1?'s':''} · ${edges.length} edge${edges.length!==1?'s':''} · Click a node or edge to select it</span>`;
      return;
    }

    // ── Node selected ──
    if (this._selType === 'node') {
      const node = (this.node.attrs.nodes||[]).find(n => n.id === this._sel);
      if (!node) { this._sel = null; this._updatePanel(); return; }

      this._panel.innerHTML = `
        <span class="gb-panel-lbl">Label</span>
        <input class="gb-panel-inp" type="text" value="${ea(node.label||'')}" placeholder="Node label…" spellcheck="false"/>
        <span class="gb-panel-lbl">Colour</span>
        <div class="gb-palette">
          ${PALETTE.map(c => `
            <button class="gb-swatch ${node.color===c?'gb-swatch--on':''}"
              data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>
        <button class="gb-panel-del-btn">🗑 Delete node</button>`;

      const inp = this._panel.querySelector('.gb-panel-inp');
      inp.addEventListener('blur', () => {
        const v = inp.value;
        this._patch(cur => ({ nodes: cur.nodes.map(n => n.id===this._sel ? {...n,label:v} : n) }));
      });
      inp.addEventListener('keydown', e => { if (e.key==='Enter') inp.blur(); });

      this._panel.querySelectorAll('.gb-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          const color = sw.dataset.color;
          this._patch(cur => ({ nodes: cur.nodes.map(n => n.id===this._sel ? {...n,color} : n) }));
        });
      });

      this._panel.querySelector('.gb-panel-del-btn').addEventListener('click', () => {
        this._deleteNode(this._sel);
      });
      return;
    }

    // ── Edge selected ──
    if (this._selType === 'edge') {
      const edge = (this.node.attrs.edges||[]).find(e => e.id===this._sel);
      if (!edge) { this._sel = null; this._updatePanel(); return; }

      const nodes = this.node.attrs.nodes||[];
      const sLabel = nodes.find(n => n.id===edge.source)?.label || edge.source;
      const tLabel = nodes.find(n => n.id===edge.target)?.label || edge.target;

      this._panel.innerHTML = `
        <span class="gb-panel-lbl">Edge</span>
        <span class="gb-edge-desc"><strong>${eh(sLabel)}</strong> → <strong>${eh(tLabel)}</strong></span>
        <span class="gb-panel-lbl">Label</span>
        <input class="gb-panel-inp" type="text" value="${ea(edge.label||'')}" placeholder="Edge label (optional)…" spellcheck="false"/>
        <button class="gb-panel-del-btn">🗑 Delete edge</button>`;

      const inp = this._panel.querySelector('.gb-panel-inp');
      inp.addEventListener('blur', () => {
        const v = inp.value;
        this._patch(cur => ({ edges: cur.edges.map(e => e.id===this._sel ? {...e,label:v} : e) }));
      });
      inp.addEventListener('keydown', e => { if (e.key==='Enter') inp.blur(); });

      this._panel.querySelector('.gb-panel-del-btn').addEventListener('click', () => {
        this._deleteEdge(this._sel);
      });
    }
  }

  // ── Pointer events ────────────────────────────────────────────────────────────

  _onBgClick(e) {
    if (this._mode === 'add') {
      const { x, y } = this._svgPt(e);
      this._addNode(x, y);
    } else {
      this._deselect();
    }
  }

  _onNodeDown(e, node) {
    if (this._mode !== 'select') return;
    e.stopPropagation();
    const { x, y } = this._svgPt(e);
    this._drag = { id:node.id, startX:x, startY:y, nodeX:node.x, nodeY:node.y };
  }

  _onNodeClick(e, node) {
    e.stopPropagation();
    if (this._mode === 'select') {
      this._sel = node.id; this._selType = 'node';
      this._renderNodes();
      this._renderEdges();
      this._updatePanel();
      this._syncDelBtn();
    } else if (this._mode === 'connect') {
      if (!this._src) {
        this._src = node.id;
        this._updatePanel();
        this._renderNodes();
      } else if (this._src !== node.id) {
        this._addEdge(this._src, node.id);
        this._src = null;
        this._updatePanel();
      }
      // clicking same node twice → self-loop
      else {
        this._addEdge(this._src, node.id);
        this._src = null;
        this._updatePanel();
      }
    }
  }

  _onSvgMove(e) {
    if (!this._drag) return;
    const { x, y } = this._svgPt(e);
    const dx = x - this._drag.startX;
    const dy = y - this._drag.startY;
    const nx = clamp(this._drag.nodeX + dx, R+2, W-R-2);
    const ny = clamp(this._drag.nodeY + dy, R+2, H-R-2);
    this._drag._nx = nx; this._drag._ny = ny;

    // Update SVG DOM directly (no ProseMirror round-trip per frame)
    const g = this._nodesLayer?.querySelector(`.gb-node[data-id="${this._drag.id}"]`);
    if (g) {
      g.querySelectorAll('circle').forEach(c => {
        c.setAttribute('cx', nx); c.setAttribute('cy', ny);
      });
      const t = g.querySelector('text');
      if (t) { t.setAttribute('x', nx); t.setAttribute('y', ny); }
    }
  }

  _onSvgUp(e) {
    if (!this._drag) return;
    const { id, _nx, _ny, nodeX, nodeY } = this._drag;
    this._drag = null;
    if (_nx == null) return;
    if (Math.abs(_nx-nodeX) < 3 && Math.abs(_ny-nodeY) < 3) return; // treat as click
    this._patch(cur => ({
      nodes: cur.nodes.map(n => n.id===id ? {...n, x:Math.round(_nx), y:Math.round(_ny)} : n),
    }));
  }

  _onSvgLeave() {
    this._onSvgUp(null); // commit pending drag
  }

  // ── Data mutations ────────────────────────────────────────────────────────────

  _addNode(x, y) {
    this._patch(cur => {
      const id    = `n${cur.nextId||1}`;
      const color = PALETTE[(cur.nodes.length) % PALETTE.length];
      const node  = { id, label:`Node ${cur.nextId||1}`, x:Math.round(x), y:Math.round(y), color };
      return { nodes:[...cur.nodes, node], nextId:(cur.nextId||1)+1 };
    });
  }

  _addEdge(srcId, tgtId) {
    this._patch(cur => {
      if (cur.edges.some(e => e.source===srcId && e.target===tgtId)) return {};
      const id   = `e${cur.nextEdgeId||1}`;
      const edge = { id, source:srcId, target:tgtId, label:'' };
      return { edges:[...cur.edges, edge], nextEdgeId:(cur.nextEdgeId||1)+1 };
    });
  }

  _deleteNode(id) {
    this._sel = null; this._selType = null;
    this._patch(cur => ({
      nodes: cur.nodes.filter(n => n.id!==id),
      edges: cur.edges.filter(e => e.source!==id && e.target!==id),
    }));
  }

  _deleteEdge(id) {
    this._sel = null; this._selType = null;
    this._patch(cur => ({ edges: cur.edges.filter(e => e.id!==id) }));
  }

  _selectEdge(id) {
    this._sel = id; this._selType = 'edge';
    this._renderEdges();
    this._renderNodes();
    this._updatePanel();
    this._syncDelBtn();
  }

  _deselect() {
    this._sel = null; this._selType = null;
    this._renderNodes();
    this._renderEdges();
    this._updatePanel();
    this._syncDelBtn();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _edgePts(s, t) {
    const dx = t.x-s.x, dy = t.y-s.y;
    const len = Math.sqrt(dx*dx+dy*dy) || 1;
    const ux = dx/len, uy = dy/len;
    return {
      x1: s.x + ux*R,
      y1: s.y + uy*R,
      x2: t.x - ux*(R+ARROW_GAP),
      y2: t.y - uy*(R+ARROW_GAP),
    };
  }

  _svgPt(e) {
    const rect = this._svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left)  / rect.width  * W,
      y: (e.clientY - rect.top)   / rect.height * H,
    };
  }

  _cursor() {
    return { select:'default', add:'crosshair', connect:'cell' }[this._mode] || 'default';
  }

  _syncDelBtn() {
    const btn = this._toolbar?.querySelector('.gb-del-sel-btn');
    if (btn) btn.disabled = !this._sel;
  }

  // Create SVG element with attrs object
  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Append a <g> to parent and return it
  _svgG(parent, cls) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', cls);
    parent.appendChild(g);
    return g;
  }

  // ── ProseMirror NodeView interface ────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (this._drag) return true;  // don't rebuild mid-drag
    this._build();
    return true;
  }
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function ea(s) { return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function eh(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
