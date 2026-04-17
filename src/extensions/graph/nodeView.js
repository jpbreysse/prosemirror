/**
 * extensions/graph/nodeView.js
 *
 * A ProseMirror NodeView that renders a Chart.js chart.
 * Includes an inline edit panel to change type, title, data, and colour.
 *
 * Lifecycle:
 *   constructor  → build DOM, draw initial chart
 *   update()     → called by PM when attrs change; redraw in place
 *   destroy()    → chart.destroy() to free canvas memory
 *   stopEvent()  → return true so PM doesn't swallow clicks inside the node
 *   ignoreMutation() → return true so PM doesn't react to our DOM changes
 */

import {
  Chart,
  BarController, LineController, PieController, DoughnutController,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Title,
} from "chart.js";

// Register only the components we need (keeps bundle smaller than registerables)
Chart.register(
  BarController, LineController, PieController, DoughnutController,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Title,
);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function field(labelText, inputEl) {
  const wrap  = document.createElement("label");
  wrap.className = "graph-field";
  const lbl   = document.createElement("span");
  lbl.textContent = labelText;
  wrap.append(lbl, inputEl);
  return wrap;
}

function textInput(value) {
  const el = document.createElement("input");
  el.type  = "text";
  el.value = value;
  return el;
}

function colorInput(value) {
  const el = document.createElement("input");
  el.type  = "color";
  el.value = value;
  return el;
}

function selectInput(options, current) {
  const el = document.createElement("select");
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
    if (opt === current) o.selected = true;
    el.appendChild(o);
  });
  return el;
}

// ------------------------------------------------------------------
// NodeView class
// ------------------------------------------------------------------

export class GraphNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this.chart  = null;
    this._panelOpen = false;

    // ── Outer wrapper ────────────────────────────────────────────
    this.dom = document.createElement("div");
    this.dom.className = "graph-node";

    // ── Chart canvas ─────────────────────────────────────────────
    this.canvas = document.createElement("canvas");
    this.canvas.className = "graph-canvas";
    this.dom.appendChild(this.canvas);

    // ── Edit button (top-right) ───────────────────────────────────
    const editBtn = document.createElement("button");
    editBtn.className = "graph-edit-btn";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._togglePanel();
    });
    this.dom.appendChild(editBtn);

    // ── Edit panel ────────────────────────────────────────────────
    this._buildPanel(node.attrs);
    this.dom.appendChild(this.panel);

    // ── Initial chart render ──────────────────────────────────────
    this._renderChart(node.attrs);
  }

  // ── Panel construction ──────────────────────────────────────────

  _buildPanel(attrs) {
    this.panel = document.createElement("div");
    this.panel.className = "graph-panel";
    this.panel.style.display = "none";

    this._titleInput    = textInput(attrs.title);
    this._typeInput     = selectInput(["bar", "line", "pie", "doughnut"], attrs.chartType);
    this._labelsInput   = textInput(attrs.labels.join(", "));
    this._dataInput     = textInput(attrs.data.join(", "));
    this._colorInput    = colorInput(attrs.color);

    const applyBtn = document.createElement("button");
    applyBtn.textContent  = "Apply";
    applyBtn.className    = "graph-apply-btn";
    applyBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._applyPanel();
    });

    this.panel.append(
      field("Title",              this._titleInput),
      field("Type",               this._typeInput),
      field("Labels (comma-sep)", this._labelsInput),
      field("Values (comma-sep)", this._dataInput),
      field("Colour",             this._colorInput),
      applyBtn,
    );
  }

  _togglePanel() {
    this._panelOpen = !this._panelOpen;
    this.panel.style.display = this._panelOpen ? "block" : "none";
  }

  _applyPanel() {
    const newAttrs = {
      title:     this._titleInput.value.trim() || "My Chart",
      chartType: this._typeInput.value,
      labels:    this._labelsInput.value.split(",").map((s) => s.trim()).filter(Boolean),
      data:      this._dataInput.value.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n)),
      color:     this._colorInput.value,
    };

    // Dispatch a transaction to update the node's attributes (immutable)
    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...newAttrs })
    );
    this._togglePanel();
  }

  // ── Chart rendering ─────────────────────────────────────────────

  _renderChart({ chartType, title, labels, data, color }) {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const isRadial = chartType === "pie" || chartType === "doughnut";

    this.chart = new Chart(this.canvas, {
      type: chartType,
      data: {
        labels,
        datasets: [{
          label: title,
          data,
          backgroundColor: isRadial
            ? data.map((_, i) => `hsl(${(i * 47 + 200) % 360}, 65%, 60%)`)
            : color + "cc",
          borderColor:     isRadial
            ? data.map((_, i) => `hsl(${(i * 47 + 200) % 360}, 65%, 45%)`)
            : color,
          borderWidth: 2,
          borderRadius: chartType === "bar" ? 4 : 0,
          tension: 0.35,
          fill: false,
          pointRadius: chartType === "line" ? 4 : 0,
        }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: isRadial },
          title:  { display: !!title, text: title },
        },
        scales: isRadial ? {} : {
          x: { grid: { color: "#f1f5f9" } },
          y: { grid: { color: "#f1f5f9" }, beginAtZero: true },
        },
      },
    });
  }

  // ── ProseMirror NodeView interface ──────────────────────────────

  update(node) {
    // Reject if the node type changed (PM will recreate the view)
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._renderChart(node.attrs);

    // Sync panel inputs if open
    if (this._panelOpen) {
      this._titleInput.value  = node.attrs.title;
      this._typeInput.value   = node.attrs.chartType;
      this._labelsInput.value = node.attrs.labels.join(", ");
      this._dataInput.value   = node.attrs.data.join(", ");
      this._colorInput.value  = node.attrs.color;
    }
    return true;
  }

  destroy() {
    if (this.chart) this.chart.destroy();
  }

  // Hand all events inside the node to us, not ProseMirror
  stopEvent(event) {
    // Allow keyboard navigation to escape the node (arrow keys, Escape)
    if (event.type === "keydown") return false;
    return true;
  }

  ignoreMutation() {
    return true;
  }
}
