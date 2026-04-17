/**
 * SubGraphNodeView
 *
 * A generic data-driven component subgraph.
 * Reads { nodes[], edges[] } from attrs and auto-layouts them
 * using a BFS-layered algorithm, then renders an interactive SVG.
 *
 * attrs:
 *   title      — display heading
 *   parentId   — e.g. "EM-001" (shown as breadcrumb)
 *   graphType  — "generic" | "component"
 *   nodes      — [{ id, label, sublabel, color, border }]
 *   edges      — [{ source, target, type, label }]
 *   equipmentDocs — {} (reserved for future doc links per sub-node)
 */

let _sgCounter = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Edge style catalogue
// ─────────────────────────────────────────────────────────────────────────────
const EDGE_STYLES = {
  drives:     { stroke: '#059669', dash: '',    width: 2   },
  powers:     { stroke: '#4f46e5', dash: '',    width: 2   },
  buffers:    { stroke: '#4f46e5', dash: '',    width: 1.5 },
  feeds:      { stroke: '#4f46e5', dash: '4 3', width: 1.5 },
  charges:    { stroke: '#4f46e5', dash: '',    width: 1.5 },
  controls:   { stroke: '#7c3aed', dash: '',    width: 1.5 },
  monitors:   { stroke: '#7c3aed', dash: '5 3', width: 1.2 },
  cools:      { stroke: '#0284c7', dash: '5 3', width: 1.2 },
  heats:      { stroke: '#dc2626', dash: '5 3', width: 1.2 },
  supports:   { stroke: '#6b7280', dash: '',    width: 1   },
  boosts:     { stroke: '#d97706', dash: '',    width: 2   },
  injects:    { stroke: '#ca8a04', dash: '3 2', width: 1.2 },
  lubricates: { stroke: '#0284c7', dash: '3 2', width: 1.2 },
  'EM force': { stroke: '#059669', dash: '',    width: 2   },
};

function edgeStyle(type) {
  return EDGE_STYLES[type] || { stroke: '#6b7280', dash: '', width: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-layout: BFS layering → column × row grid
// ─────────────────────────────────────────────────────────────────────────────
function autoLayout(nodes, edges, W = 900, H = 340, NW = 140, NH = 42) {
  // Build directed adjacency + in-degree
  const adj    = new Map(nodes.map(n => [n.id, []]));
  const inDeg  = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source).push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // BFS from root nodes (in-degree 0)
  const layer = new Map();
  const q = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) { layer.set(id, 0); q.push(id); }
  }
  // Fallback if graph is fully cyclic
  if (q.length === 0 && nodes.length > 0) {
    layer.set(nodes[0].id, 0); q.push(nodes[0].id);
  }
  while (q.length) {
    const cur  = q.shift();
    const next = (layer.get(cur) ?? 0) + 1;
    for (const tgt of (adj.get(cur) || [])) {
      if (!layer.has(tgt)) { layer.set(tgt, next); q.push(tgt); }
    }
  }
  // Assign unvisited nodes (disconnected)
  const maxL = Math.max(0, ...layer.values());
  for (const n of nodes) { if (!layer.has(n.id)) layer.set(n.id, maxL); }

  // Group by layer
  const byLayer = new Map();
  for (const [id, l] of layer) {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(id);
  }

  // Compute (x, y) centres for each node
  const numLayers = byLayer.size;
  const colStep   = W / (numLayers + 1);
  const pos       = {};
  for (const [l, ids] of byLayer) {
    const x       = Math.round((l + 1) * colStep);
    const rowStep = H / (ids.length + 1);
    ids.forEach((id, i) => {
      pos[id] = { x, y: Math.round((i + 1) * rowStep) };
    });
  }

  return { pos, NW, NH, W, H };
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeView
// ─────────────────────────────────────────────────────────────────────────────
export class SubGraphNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._uid   = `sg${++_sgCounter}`;
    this._cur   = null;

    this.dom = document.createElement('div');
    this.dom.className = 'sg-block';
    this._build();
  }

  _build() {
    const { title, parentId, nodes = [], edges = [] } = this.node.attrs;
    const uid = this._uid;
    this.dom.innerHTML = '';

    // ── Header ────────────────────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.className = 'sg-header';
    hdr.innerHTML = `
      <div class="sg-parent-tag">${parentId || 'subgraph'} · internal architecture</div>
      <div class="sg-title">${title}</div>
      <div class="sg-sub">${nodes.length} sub-components · ${edges.length} connections</div>`;
    this.dom.appendChild(hdr);

    if (nodes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sg-empty';
      empty.textContent = 'No sub-components defined.';
      this.dom.appendChild(empty);
      return;
    }

    // ── SVG ───────────────────────────────────────────────────────────────────
    const { pos, NW, NH, W, H } = autoLayout(nodes, edges);
    const VH = H + 20;

    // Collect unique edge types for <defs>
    const uniqueTypes = [...new Set(edges.map(e => e.type))];
    let defs = '<defs>';
    for (const t of uniqueTypes) {
      const st  = edgeStyle(t);
      const mid = `${uid}-${t.replace(/\s+/g, '-')}`;
      defs += `
        <marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 1L8 5L2 9" fill="none" stroke="${st.stroke}"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </marker>`;
    }
    defs += '</defs>';

    // Edges
    let edgesSVG = '';
    for (const e of edges) {
      const s  = pos[e.source];
      const t  = pos[e.target];
      if (!s || !t) continue;
      const st = edgeStyle(e.type);
      const markerId = `${uid}-${e.type.replace(/\s+/g, '-')}`;
      const dashAttr = st.dash ? `stroke-dasharray="${st.dash}"` : '';

      let x1, y1, x2, y2;
      if (s.x < t.x) {
        // Forward: right of source → left of target
        x1 = s.x + NW / 2; y1 = s.y;
        x2 = t.x - NW / 2; y2 = t.y;
      } else if (s.x > t.x) {
        // Backward: left of source → right of target
        x1 = s.x - NW / 2; y1 = s.y;
        x2 = t.x + NW / 2; y2 = t.y;
      } else {
        // Same column: bottom of upper → top of lower
        x1 = s.x; y1 = s.y + NH / 2;
        x2 = t.x; y2 = t.y - NH / 2;
      }

      const cpx = (x1 + x2) / 2;
      const lbx = (x1 + x2) / 2;
      const lby = (y1 + y2) / 2 - 5;

      edgesSVG += `
        <path d="M${x1},${y1} C${cpx},${y1} ${cpx},${y2} ${x2},${y2}"
          fill="none" stroke="${st.stroke}" stroke-width="${st.width}" ${dashAttr}
          marker-end="url(#${markerId})"/>
        <text x="${lbx}" y="${lby}" text-anchor="middle"
          font-family="system-ui,sans-serif" font-size="8" fill="${st.stroke}" opacity="0.75"
          pointer-events="none">${e.label || e.type}</text>`;
    }

    // Nodes
    let nodesSVG = '';
    for (const n of nodes) {
      const p = pos[n.id];
      if (!p) continue;
      const rx = p.x - NW / 2;
      const ry = p.y - NH / 2;
      nodesSVG += `
        <g class="sg-node" data-id="${n.id}" style="cursor:pointer">
          <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="7"
            fill="${n.color || '#f3f4f6'}" stroke="${n.border || '#6b7280'}" stroke-width="1"
            class="sg-bg"/>
          <text x="${p.x}" y="${p.y - 3}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="11" font-weight="600"
            fill="${n.border || '#374151'}">${n.label}</text>
          <text x="${p.x}" y="${p.y + 12}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="8.5" fill="${n.border || '#6b7280'}"
            opacity="0.8">${n.sublabel || ''}</text>
        </g>`;
    }

    const svgWrap = document.createElement('div');
    svgWrap.className = 'sg-graph-wrap';
    svgWrap.innerHTML = `
<svg width="100%" viewBox="0 0 ${W} ${VH}" style="display:block;min-width:520px">
  ${defs}
  ${edgesSVG}
  ${nodesSVG}
</svg>`;

    svgWrap.querySelectorAll('.sg-node').forEach(el => {
      el.addEventListener('click', () => this._selNode(el.dataset.id));
    });

    this.dom.appendChild(svgWrap);

    // ── Detail strip ──────────────────────────────────────────────────────────
    this._strip = document.createElement('div');
    this._strip.className = 'sg-strip';
    this._strip.innerHTML = '<span class="sg-hint">↑ Click any sub-component to see its label</span>';
    this.dom.appendChild(this._strip);

    if (this._cur) this._highlightNode(this._cur);
  }

  _selNode(id) {
    if (this._cur) this._highlightNode(this._cur, false);
    this._cur = id;
    this._highlightNode(id, true);
    const n = (this.node.attrs.nodes || []).find(x => x.id === id);
    if (n) {
      this._strip.innerHTML = `
        <span class="sg-sel-id">${n.label}</span>
        <span class="sg-sel-sub">${n.sublabel || ''}</span>`;
    }
  }

  _highlightNode(id, on = true) {
    const el = this.dom.querySelector(`.sg-node[data-id="${id}"] .sg-bg`);
    if (!el) return;
    el.style.filter      = on ? 'drop-shadow(0 0 5px rgba(0,0,0,.25))' : '';
    el.style.strokeWidth = on ? '2.5' : '';
  }

  // ── ProseMirror NodeView interface ─────────────────────────────────────────
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}
