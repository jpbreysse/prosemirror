/**
 * extensions/diagram/nodeView.js
 *
 * A ProseMirror NodeView that renders an interactive node-edge diagram
 * using Cytoscape.js.
 *
 * Interactions:
 *   • Drag a node      → saves new position into the document
 *   • Double-click bg  → adds a new node at that position
 *   • "Add Edge" mode  → click source node, then target node → creates an edge
 *   • Right-click node/edge (or panel) → deletes the element
 *   • Edit panel       → rename nodes, manage edges, change layout & height
 *
 * ProseMirror integration:
 *   • stopEvent()      → true for all mouse/touch/wheel so Cytoscape handles them
 *   • ignoreMutation() → true so Cytoscape's canvas redraws don't confuse PM
 *   • Every structural change dispatches a setNodeMarkup transaction (undo-able)
 */

import cytoscape from "cytoscape";

// ── Unique id helper ─────────────────────────────────────────────────────────
let _seq = 0;
const uid = (prefix = "n") => `${prefix}${Date.now()}_${++_seq}`;

// ── Cytoscape style sheet ────────────────────────────────────────────────────
const CY_STYLE = [
  {
    selector: "node",
    style: {
      label:                "data(label)",
      "background-color":   "#6366f1",
      "border-color":       "#4f46e5",
      "border-width":       2,
      color:                "#fff",
      "font-size":          13,
      "font-weight":        600,
      "text-valign":        "center",
      "text-halign":        "center",
      "text-wrap":          "wrap",
      "text-max-width":     90,
      width:                100,
      height:               40,
      shape:                "round-rectangle",
      "padding":            8,
    },
  },
  {
    selector: "node:selected",
    style: {
      "background-color": "#4f46e5",
      "border-color":     "#312e81",
      "border-width":     3,
    },
  },
  {
    selector: "node.edge-source",
    style: {
      "background-color": "#f59e0b",
      "border-color":     "#d97706",
    },
  },
  {
    selector: "edge",
    style: {
      width:                  2,
      "line-color":           "#a5b4fc",
      "target-arrow-color":   "#6366f1",
      "target-arrow-shape":   "triangle",
      "curve-style":          "bezier",
      label:                  "data(label)",
      "font-size":            11,
      color:                  "#52525b",
      "text-background-color":"#fff",
      "text-background-opacity": 0.8,
      "text-background-padding": "2px",
    },
  },
  {
    selector: "edge:selected",
    style: {
      "line-color":         "#4f46e5",
      "target-arrow-color": "#4f46e5",
      width: 3,
    },
  },
];

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.flat().forEach(c => c && e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}

function labelInput(value, onchange) {
  const input = el("input", { type: "text", class: "diag-input", value });
  input.addEventListener("change", () => onchange(input.value.trim() || "?"));
  input.addEventListener("mousedown", e => e.stopPropagation());
  input.addEventListener("click",     e => e.stopPropagation());
  return input;
}

function select(options, current, onchange) {
  const s = el("select", { class: "diag-select" });
  options.forEach(([val, label]) => {
    const o = el("option", { value: val }, label);
    if (val === current) o.selected = true;
    s.appendChild(o);
  });
  s.addEventListener("change",     () => onchange(s.value));
  s.addEventListener("mousedown",  e => e.stopPropagation());
  return s;
}

// ── NodeView ─────────────────────────────────────────────────────────────────

export class DiagramNodeView {
  constructor(node, view, getPos) {
    this.node    = node;
    this.view    = view;
    this.getPos  = getPos;
    this.cy      = null;
    this._edgeSourceId = null;   // id of the node waiting for an edge target
    this._panelOpen    = false;

    // Outer wrapper
    this.dom = el("div", { class: "diagram-node" });

    // Toolbar row
    this.toolbar = el("div", { class: "diagram-toolbar" });
    this._buildToolbar();
    this.dom.appendChild(this.toolbar);

    // Cytoscape canvas container
    this.container = el("div", { class: "diagram-container" });
    this.container.style.height = node.attrs.height + "px";
    this.dom.appendChild(this.container);

    // Caption
    this.captionEl = el("p", { class: "diagram-caption" });
    this._syncCaption(node.attrs.caption);
    this.dom.appendChild(this.captionEl);

    // Edit panel (hidden by default)
    this.panel = el("div", { class: "diagram-panel" });
    this.panel.style.display = "none";
    this.dom.appendChild(this.panel);

    // Defer Cytoscape init until the DOM is live and sized
    requestAnimationFrame(() => this._initCy(node.attrs));
  }

  // ── Cytoscape init ───────────────────────────────────────────────

  _initCy({ nodes, edges, layout, height }) {
    if (this.cy) return;

    this.container.style.height = height + "px";

    this.cy = cytoscape({
      container: this.container,
      elements:  this._toElements({ nodes, edges }),
      layout:    this._layoutConfig(layout),
      style:     CY_STYLE,
      userZoomingEnabled:   true,
      userPanningEnabled:   true,
      boxSelectionEnabled:  false,
      autoungrabify:        false,
    });

    // ── Interactions ────────────────────────────────────────────

    // Persist node position after drag
    this.cy.on("dragfree", "node", () => this._persistPositions());

    // Double-click on background → add node
    this.cy.on("dblclick", (e) => {
      if (e.target === this.cy) {
        const pos = e.position;
        this._addNode(pos.x, pos.y);
      }
    });

    // Right-click on node or edge → delete
    this.cy.on("cxttap", "node, edge", (e) => {
      this._deleteElement(e.target.id());
    });

    // Tap on node → edge-drawing mode
    this.cy.on("tap", "node", (e) => {
      const id = e.target.id();

      if (!this._edgeSourceId) {
        // First tap: mark as source
        this._edgeSourceId = id;
        e.target.addClass("edge-source");
        this._setStatus("Click a target node to connect, or click background to cancel");
      } else if (this._edgeSourceId === id) {
        // Tapped the same node: cancel
        this._cancelEdgeDraw();
      } else {
        // Second tap: create edge
        this._addEdge(this._edgeSourceId, id);
        this._cancelEdgeDraw();
      }
    });

    // Tap on background → cancel edge-drawing mode
    this.cy.on("tap", (e) => {
      if (e.target === this.cy && this._edgeSourceId) {
        this._cancelEdgeDraw();
      }
    });
  }

  // ── Layout config ─────────────────────────────────────────────────

  _layoutConfig(name) {
    const base = { name, fit: false, animate: false };
    if (name === "preset")         return { ...base, positions: (n) => ({ x: n.data("x") || 0, y: n.data("y") || 0 }) };
    if (name === "breadthfirst")   return { ...base, directed: true, spacingFactor: 1.25 };
    if (name === "cose")           return { ...base, animate: false, randomize: false };
    return base;
  }

  // ── Elements helpers ─────────────────────────────────────────────

  _toElements({ nodes, edges }) {
    return [
      ...nodes.map(n => ({ data: { id: n.id, label: n.label, x: n.x, y: n.y }, position: { x: n.x || 0, y: n.y || 0 } })),
      ...edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label || "" } })),
    ];
  }

  _snapshotNodes() {
    return this.node.attrs.nodes.map(n => {
      const cyNode = this.cy.$(`#${n.id}`);
      const pos = cyNode.length ? cyNode.position() : { x: n.x || 0, y: n.y || 0 };
      return { ...n, x: Math.round(pos.x), y: Math.round(pos.y) };
    });
  }

  // ── Mutations (all go through ProseMirror transactions) ──────────

  _updateAttrs(patch) {
    const { state, dispatch } = this.view;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...patch }));
  }

  _persistPositions() {
    this._updateAttrs({ nodes: this._snapshotNodes() });
  }

  _addNode(x, y) {
    const id    = uid("n");
    const label = "New node";
    const node  = { id, label, x: Math.round(x), y: Math.round(y) };
    this._updateAttrs({ nodes: [...this.node.attrs.nodes, node] });
  }

  _addEdge(sourceId, targetId) {
    // Avoid duplicate edges
    const exists = this.node.attrs.edges.some(
      e => e.source === sourceId && e.target === targetId
    );
    if (exists) return;
    const edge = { id: uid("e"), source: sourceId, target: targetId, label: "" };
    this._updateAttrs({ edges: [...this.node.attrs.edges, edge] });
  }

  _deleteElement(id) {
    this._updateAttrs({
      nodes: this.node.attrs.nodes.filter(n => n.id !== id),
      // Also remove any edges that reference a deleted node
      edges: this.node.attrs.edges.filter(e => e.id !== id && e.source !== id && e.target !== id),
    });
  }

  _renameNode(id, label) {
    this._updateAttrs({
      nodes: this.node.attrs.nodes.map(n => n.id === id ? { ...n, label } : n),
    });
  }

  _renameEdge(id, label) {
    this._updateAttrs({
      edges: this.node.attrs.edges.map(e => e.id === id ? { ...e, label } : e),
    });
  }

  // ── Edge-drawing mode ────────────────────────────────────────────

  _cancelEdgeDraw() {
    if (this._edgeSourceId) {
      this.cy.$(`#${this._edgeSourceId}`).removeClass("edge-source");
      this._edgeSourceId = null;
    }
    this._setStatus("");
  }

  _setStatus(msg) {
    const s = this.toolbar.querySelector(".diag-status");
    if (s) s.textContent = msg;
  }

  // ── Toolbar ──────────────────────────────────────────────────────

  _buildToolbar() {
    const addNodeBtn = el("button", {
      class: "diag-btn",
      title: "Add node (or double-click the canvas)",
      onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); },
      onclick: (e) => { e.stopPropagation(); this._addNode(100 + Math.random() * 200, 100 + Math.random() * 200); },
    }, "+ Node");

    const addEdgeBtn = el("button", {
      class: "diag-btn",
      title: "Add edge: click source node then target node",
      onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); },
      onclick: (e) => { e.stopPropagation(); this._setStatus("Click a source node…"); },
    }, "+ Edge");

    const fitBtn = el("button", {
      class: "diag-btn",
      title: "Fit diagram to view",
      onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); },
      onclick: (e) => { e.stopPropagation(); this.cy?.fit(undefined, 30); },
    }, "⊡ Fit");

    const editBtn = el("button", {
      class: "diag-btn diag-btn--edit",
      title: "Edit diagram",
      onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); },
      onclick: (e) => { e.stopPropagation(); this._togglePanel(); },
    }, "✎ Edit");

    const status = el("span", { class: "diag-status" });

    this.toolbar.append(addNodeBtn, addEdgeBtn, fitBtn, editBtn, status);
  }

  // ── Edit panel ───────────────────────────────────────────────────

  _togglePanel() {
    this._panelOpen = !this._panelOpen;
    this.panel.style.display = this._panelOpen ? "block" : "none";
    if (this._panelOpen) this._renderPanel();
  }

  _renderPanel() {
    this.panel.innerHTML = "";

    const { nodes, edges, layout, height, caption } = this.node.attrs;

    // ── Settings row ──────────────────────────────────────────
    const settingsRow = el("div", { class: "diag-panel-row" });

    settingsRow.appendChild(el("label", { class: "diag-field" },
      el("span", {}, "Layout"),
      select(
        [["preset","Preset (free drag)"],["breadthfirst","Top-down"],["circle","Circle"],["cose","Force-directed"],["grid","Grid"]],
        layout,
        (val) => {
          this._updateAttrs({ layout: val });
          if (val !== "preset") {
            requestAnimationFrame(() => this.cy?.layout(this._layoutConfig(val)).run());
          }
        }
      )
    ));

    const heightInput = el("input", { type: "number", class: "diag-input", value: height, min: 150, max: 900, step: 50 });
    heightInput.addEventListener("change", () => this._updateAttrs({ height: parseInt(heightInput.value) || 400 }));
    heightInput.addEventListener("mousedown", e => e.stopPropagation());
    settingsRow.appendChild(el("label", { class: "diag-field" }, el("span", {}, "Height (px)"), heightInput));

    const captionInput = el("input", { type: "text", class: "diag-input diag-input--wide", value: caption, placeholder: "Optional caption…" });
    captionInput.addEventListener("change", () => this._updateAttrs({ caption: captionInput.value.trim() }));
    captionInput.addEventListener("mousedown", e => e.stopPropagation());
    settingsRow.appendChild(el("label", { class: "diag-field" }, el("span", {}, "Caption"), captionInput));

    this.panel.appendChild(settingsRow);

    // ── Nodes table ───────────────────────────────────────────
    this.panel.appendChild(el("h4", { class: "diag-panel-heading" }, "Nodes"));
    const nodeTable = el("div", { class: "diag-table" });

    nodes.forEach(n => {
      const row = el("div", { class: "diag-table-row" });
      const idTag = el("span", { class: "diag-id-tag" }, n.id);
      const lbl   = labelInput(n.label, (val) => this._renameNode(n.id, val));
      const del   = el("button", { class: "diag-del-btn", title: "Delete node" }, "✕");
      del.addEventListener("mousedown", e => e.preventDefault());
      del.addEventListener("click",     () => this._deleteElement(n.id));
      row.append(idTag, lbl, del);
      nodeTable.appendChild(row);
    });

    // Add-node inline form
    const newNodeInput = el("input", { type: "text", class: "diag-input", placeholder: "Label…" });
    newNodeInput.addEventListener("mousedown", e => e.stopPropagation());
    const addNodeBtn = el("button", { class: "diag-btn diag-btn--add" }, "+ Add node");
    addNodeBtn.addEventListener("mousedown", e => e.preventDefault());
    addNodeBtn.addEventListener("click", () => {
      const label = newNodeInput.value.trim() || "New node";
      this._addNode(100 + Math.random() * 300, 100 + Math.random() * 200);
      // Rename the node we just added to use the typed label
      const lastId = this.node.attrs.nodes[this.node.attrs.nodes.length - 1]?.id;
      if (lastId) setTimeout(() => this._renameNode(lastId, label), 50);
      newNodeInput.value = "";
    });
    const addRow = el("div", { class: "diag-table-row diag-table-row--add" }, newNodeInput, addNodeBtn);
    nodeTable.appendChild(addRow);
    this.panel.appendChild(nodeTable);

    // ── Edges table ───────────────────────────────────────────
    this.panel.appendChild(el("h4", { class: "diag-panel-heading" }, "Edges"));
    const edgeTable = el("div", { class: "diag-table" });

    edges.forEach(e => {
      const row    = el("div", { class: "diag-table-row" });
      const arrow  = el("span", { class: "diag-edge-arrow" }, `${e.source} → ${e.target}`);
      const lbl    = labelInput(e.label || "", (val) => this._renameEdge(e.id, val));
      lbl.placeholder = "Edge label…";
      const del    = el("button", { class: "diag-del-btn", title: "Delete edge" }, "✕");
      del.addEventListener("mousedown", ev => ev.preventDefault());
      del.addEventListener("click",     () => this._deleteElement(e.id));
      row.append(arrow, lbl, del);
      edgeTable.appendChild(row);
    });

    // Add-edge form (select source + target)
    const nodeIds    = nodes.map(n => [n.id, `${n.id}: ${n.label}`]);
    const srcSelect  = select(nodeIds, nodes[0]?.id, () => {});
    const tgtSelect  = select(nodeIds, nodes[1]?.id || nodes[0]?.id, () => {});
    const addEdgeBtn = el("button", { class: "diag-btn diag-btn--add" }, "+ Add edge");
    addEdgeBtn.addEventListener("mousedown", ev => ev.preventDefault());
    addEdgeBtn.addEventListener("click", () => {
      this._addEdge(srcSelect.value, tgtSelect.value);
    });
    const edgeAddRow = el("div", { class: "diag-table-row diag-table-row--add" },
      el("span", { class: "diag-field-inline" }, el("span", {}, "From"), srcSelect),
      el("span", { class: "diag-field-inline" }, el("span", {}, "To"),   tgtSelect),
      addEdgeBtn,
    );
    edgeTable.appendChild(edgeAddRow);
    this.panel.appendChild(edgeTable);
  }

  // ── ProseMirror NodeView interface ───────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;

    const prev = this.node;
    this.node  = node;

    if (!this.cy) return true;

    const { nodes, edges, layout, height } = node.attrs;

    // Resize container if height changed
    if (height !== prev.attrs.height) {
      this.container.style.height = height + "px";
      this.cy.resize();
      this.cy.fit(undefined, 30);
    }

    // Patch elements: add new, remove deleted, update labels
    const cyNodeIds = new Set(this.cy.nodes().map(n => n.id()));
    const cyEdgeIds = new Set(this.cy.edges().map(e => e.id()));

    // Add new nodes
    nodes.forEach(n => {
      if (!cyNodeIds.has(n.id)) {
        this.cy.add({ data: { id: n.id, label: n.label }, position: { x: n.x || 100, y: n.y || 100 } });
      } else {
        // Update label
        this.cy.$(`#${n.id}`).data("label", n.label);
      }
    });

    // Remove deleted nodes
    const newNodeIds = new Set(nodes.map(n => n.id));
    this.cy.nodes().forEach(n => { if (!newNodeIds.has(n.id())) n.remove(); });

    // Add new edges
    edges.forEach(e => {
      if (!cyEdgeIds.has(e.id)) {
        this.cy.add({ data: { id: e.id, source: e.source, target: e.target, label: e.label || "" } });
      } else {
        this.cy.$(`#${e.id}`).data("label", e.label || "");
      }
    });

    // Remove deleted edges
    const newEdgeIds = new Set(edges.map(e => e.id));
    this.cy.edges().forEach(e => { if (!newEdgeIds.has(e.id())) e.remove(); });

    // Re-run layout if it changed (but not preset — that would overwrite drags)
    if (layout !== prev.attrs.layout && layout !== "preset") {
      this.cy.layout(this._layoutConfig(layout)).run();
    }

    this._syncCaption(node.attrs.caption);

    // Re-render the panel if it's open
    if (this._panelOpen) this._renderPanel();

    return true;
  }

  destroy() {
    if (this.cy) {
      this.cy.destroy();
      this.cy = null;
    }
  }

  _syncCaption(text) {
    this.captionEl.textContent = text || "";
    this.captionEl.style.display = text ? "block" : "none";
  }

  // Hand ALL mouse/touch/wheel events to Cytoscape
  stopEvent(event) {
    const t = event.type;
    // Still allow keyboard events to bubble up to ProseMirror
    if (t === "keydown" || t === "keyup" || t === "keypress") return false;
    return true;
  }

  // Cytoscape redraws its canvas constantly — ignore all DOM mutations
  ignoreMutation() { return true; }
}
