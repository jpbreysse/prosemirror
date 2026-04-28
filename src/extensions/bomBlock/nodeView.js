/**
 * BomBlockNodeView
 *
 * Interactive Bill of Materials — a collapsible component tree embedded
 * in a ProseMirror document.
 *
 * Features:
 *  • Expand / collapse sub-trees
 *  • Double-click any cell to edit name, qty, unit inline
 *  • "+" button on any row to add a child component
 *  • "×" button to delete (with its whole subtree)
 *  • Total qty propagated down (wheel ×4 → lug nut ×4×5 = 20)
 *  • All data stored in ProseMirror attrs → persisted to Postgres
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function uid() { return `bom-${Date.now()}-${++_seq}`; }

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

function findParent(node, id) {
  for (const c of node.children ?? []) {
    if (c.id === id) return node;
    const f = findParent(c, id);
    if (f) return f;
  }
  return null;
}

function countDescendants(node) {
  let n = (node.children ?? []).length;
  for (const c of node.children ?? []) n += countDescendants(c);
  return n;
}

// ── NodeView ──────────────────────────────────────────────────────────────────

export class BomBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "bom-block";
    this._build();
  }

  // ── Commit tree change to ProseMirror ──────────────────────────────────────

  _commit(tree) {
    const tr = this.view.state.tr.setNodeMarkup(
      this.getPos(), null, { ...this.node.attrs, tree }
    );
    this.view.dispatch(tr);
  }

  // ── Full re-render ─────────────────────────────────────────────────────────

  _build() {
    const tree  = deepClone(this.node.attrs.tree);
    const total = countDescendants(tree);

    this.dom.innerHTML = "";

    // ── Header ──────────────────────────────────────────────────────────────
    const hdr = document.createElement("div");
    hdr.className = "bom-header";
    hdr.innerHTML = `
      <span class="bom-header-icon">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2.5"
            stroke="currentColor" stroke-width="1.4"/>
          <path d="M4 5h5M4 8h7M4 11h3"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="bom-header-title" title="Double-click to rename">${escHtml(tree.name)}</span>
      <span class="bom-header-badge">${total} component${total !== 1 ? "s" : ""}</span>`;

    hdr.querySelector(".bom-header-title")
       .addEventListener("dblclick", () => this._editTitle(tree));
    this.dom.appendChild(hdr);

    // ── Table ────────────────────────────────────────────────────────────────
    const wrap = document.createElement("div");
    wrap.className = "bom-table-wrap";

    const table = document.createElement("table");
    table.className = "bom-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="bom-col-name">Component</th>
          <th class="bom-col-qty">Qty</th>
          <th class="bom-col-total">Total</th>
          <th class="bom-col-unit">Unit</th>
          <th class="bom-col-sensor">Sensor ID</th>
          <th class="bom-col-actions"></th>
        </tr>
      </thead>`;

    const tbody = document.createElement("tbody");
    this._renderRows(tbody, tree, 0, true, 1);
    table.appendChild(tbody);
    wrap.appendChild(table);
    this.dom.appendChild(wrap);

    // ── Root "add component" button ──────────────────────────────────────────
    const addRoot = document.createElement("button");
    addRoot.className = "bom-add-root";
    addRoot.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round"/>
      </svg>
      Add component`;
    addRoot.addEventListener("click", () => this._addChild(tree.id));
    this.dom.appendChild(addRoot);
  }

  // ── Render rows recursively ────────────────────────────────────────────────

  _renderRows(tbody, node, depth, isRoot, parentTotal) {
    const children    = node.children ?? [];
    const hasChildren = children.length > 0;
    const collapsed   = !!node.collapsed;
    const ownQty      = isRoot ? 1 : (node.qty ?? 1);
    const totalQty    = parentTotal * ownQty;

    const tr = document.createElement("tr");
    tr.className  = "bom-row" + (isRoot ? " bom-row--root" : "");
    tr.dataset.id = node.id;

    // ── Name cell ────────────────────────────────────────────────────────────
    const tdName = document.createElement("td");
    tdName.className = "bom-td-name";
    tdName.style.paddingLeft = `${depth * 22 + 10}px`;

    const toggle = document.createElement("span");
    toggle.className = "bom-toggle";
    if (hasChildren) {
      toggle.textContent = collapsed ? "▶" : "▼";
      toggle.addEventListener("click", () => {
        const t = deepClone(this.node.attrs.tree);
        const n = findNode(t, node.id);
        if (n) { n.collapsed = !n.collapsed; this._commit(t); }
      });
    } else {
      toggle.innerHTML = `<span class="bom-leaf">─</span>`;
    }
    tdName.appendChild(toggle);

    const nameLbl = document.createElement("span");
    nameLbl.className = "bom-name";
    nameLbl.textContent = node.name;
    nameLbl.title = "Double-click to edit";
    nameLbl.addEventListener("dblclick", () => this._editCell(node.id, "name", nameLbl));
    tdName.appendChild(nameLbl);

    // ── Qty cell ─────────────────────────────────────────────────────────────
    const tdQty = document.createElement("td");
    tdQty.className = "bom-td-qty";
    if (!isRoot) {
      const qtyLbl = document.createElement("span");
      qtyLbl.className = "bom-qty";
      qtyLbl.textContent = ownQty;
      qtyLbl.title = "Double-click to edit";
      qtyLbl.addEventListener("dblclick", () => this._editCell(node.id, "qty", qtyLbl, "number"));
      tdQty.appendChild(qtyLbl);
    }

    // ── Total cell ───────────────────────────────────────────────────────────
    const tdTotal = document.createElement("td");
    tdTotal.className = "bom-td-total";
    if (!isRoot) {
      const span = document.createElement("span");
      span.className = totalQty > ownQty ? "bom-total bom-total--derived" : "bom-total";
      span.textContent = totalQty;
      tdTotal.appendChild(span);
    }

    // ── Unit cell ────────────────────────────────────────────────────────────
    const tdUnit = document.createElement("td");
    tdUnit.className = "bom-td-unit";
    if (!isRoot) {
      const unitLbl = document.createElement("span");
      unitLbl.className = "bom-unit";
      unitLbl.textContent = node.unit ?? "pcs";
      unitLbl.title = "Double-click to edit";
      unitLbl.addEventListener("dblclick", () => this._editCell(node.id, "unit", unitLbl));
      tdUnit.appendChild(unitLbl);
    }

    // ── Sensor cell ──────────────────────────────────────────────────────────
    const tdSensor = document.createElement("td");
    tdSensor.className = "bom-td-sensor";
    if (!isRoot) {
      const sensorLbl = document.createElement("span");
      const hasSensor = !!node.sensor_id;
      sensorLbl.className = hasSensor ? "bom-sensor-chip" : "bom-sensor-empty";
      sensorLbl.textContent = hasSensor ? node.sensor_id : "—";
      sensorLbl.title = "Double-click to assign sensor ID";
      sensorLbl.addEventListener("dblclick", () => {
        if (!hasSensor) sensorLbl.textContent = "";
        this._editCell(node.id, "sensor_id", sensorLbl);
      });
      tdSensor.appendChild(sensorLbl);
    }

    // ── Actions cell ─────────────────────────────────────────────────────────
    const tdAct = document.createElement("td");
    tdAct.className = "bom-td-actions";

    const addBtn = document.createElement("button");
    addBtn.className = "bom-btn bom-btn--add";
    addBtn.title = "Add sub-component";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => this._addChild(node.id));
    tdAct.appendChild(addBtn);

    if (!isRoot) {
      const delBtn = document.createElement("button");
      delBtn.className = "bom-btn bom-btn--del";
      delBtn.title = "Delete component";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", () => this._deleteNode(node.id));
      tdAct.appendChild(delBtn);
    }

    tr.append(tdName, tdQty, tdTotal, tdUnit, tdSensor, tdAct);
    tbody.appendChild(tr);

    // ── Recurse into children ─────────────────────────────────────────────────
    if (hasChildren && !collapsed) {
      for (const child of children) {
        this._renderRows(tbody, child, depth + 1, false, totalQty);
      }
    }
  }

  // ── Inline cell edit ──────────────────────────────────────────────────────

  _editCell(id, field, span, type = "text") {
    const input = document.createElement("input");
    input.className = "bom-inline-input";
    input.type  = type;
    input.value = span.textContent;
    if (type === "number") { input.min = "1"; input.style.width = "52px"; }

    span.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const t = deepClone(this.node.attrs.tree);
      const n = findNode(t, id);
      if (n) {
        n[field] = type === "number"
          ? Math.max(1, parseInt(input.value) || 1)
          : (input.value.trim() || span.textContent);
        this._commit(t);
      } else {
        this._build();
      }
    };

    input.addEventListener("blur",    commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); this._build(); }
    });
  }

  // ── Edit root title ───────────────────────────────────────────────────────

  _editTitle(tree) {
    const titleEl = this.dom.querySelector(".bom-header-title");
    if (!titleEl) return;

    const input = document.createElement("input");
    input.className   = "bom-title-input";
    input.value       = tree.name;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const t   = deepClone(this.node.attrs.tree);
      t.name    = input.value.trim() || tree.name;
      this._commit(t);
    };
    input.addEventListener("blur",    commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); this._build(); }
    });
  }

  // ── Add child ─────────────────────────────────────────────────────────────

  _addChild(parentId) {
    const t      = deepClone(this.node.attrs.tree);
    const parent = findNode(t, parentId);
    if (!parent) return;
    if (!parent.children) parent.children = [];

    const newNode = { id: uid(), name: "New component", qty: 1, unit: "pcs", sensor_id: "", children: [] };
    parent.children.push(newNode);
    parent.collapsed = false;
    this._commit(t);

    // Immediately open inline edit on the new row name
    setTimeout(() => {
      const row  = this.dom.querySelector(`tr[data-id="${newNode.id}"]`);
      const span = row?.querySelector(".bom-name");
      if (span) this._editCell(newNode.id, "name", span);
    }, 30);
  }

  // ── Delete node ───────────────────────────────────────────────────────────

  _deleteNode(id) {
    const t      = deepClone(this.node.attrs.tree);
    const parent = findParent(t, id);
    if (!parent) return;
    parent.children = parent.children.filter(c => c.id !== id);
    this._commit(t);
  }

  // ── ProseMirror hooks ─────────────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._build();
    return true;
  }

  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}
