/**
 * RiskMatrixNodeView
 *
 * A 5×5 Likelihood × Impact risk assessment block.
 * Each metric is a dot on the matrix, colour-coded by severity.
 *
 * Risk score = likelihood × impact
 *   1–4   → LOW      (green)
 *   5–9   → MEDIUM   (yellow)
 *  10–14  → HIGH     (orange)
 *  15–25  → CRITICAL (red)
 *
 * Attrs:
 *   title      – block heading
 *   objectName – the thing being assessed (pump, component, project…)
 *   objectType – "equipment" | "project" | "clinical" | "software"
 *   metrics    – [{ id, name, value, unit, likelihood, impact, notes }]
 */

// ── Risk helpers ──────────────────────────────────────────────────────────────

const RISK_LEVELS = [
  { label: "LOW",      min:  1, max:  4, color: "#16a34a", bg: "#f0fdf4", text: "#166534" },
  { label: "MEDIUM",   min:  5, max:  9, color: "#ca8a04", bg: "#fefce8", text: "#854d0e" },
  { label: "HIGH",     min: 10, max: 14, color: "#ea580c", bg: "#fff7ed", text: "#9a3412" },
  { label: "CRITICAL", min: 15, max: 25, color: "#dc2626", bg: "#fef2f2", text: "#991b1b" },
];

// ISO 31000-style matrix cell colours
const MATRIX_COLORS = [
  // impact: 1        2        3        4        5
  ["#bbf7d0","#bbf7d0","#bbf7d0","#fef08a","#fef08a"],  // likelihood 1
  ["#bbf7d0","#bbf7d0","#fef08a","#fef08a","#fed7aa"],  // likelihood 2
  ["#bbf7d0","#fef08a","#fef08a","#fed7aa","#fed7aa"],  // likelihood 3
  ["#fef08a","#fef08a","#fed7aa","#fed7aa","#fecaca"],  // likelihood 4
  ["#fef08a","#fed7aa","#fed7aa","#fecaca","#fecaca"],  // likelihood 5
];

function riskLevel(likelihood, impact) {
  const score = likelihood * impact;
  return RISK_LEVELS.find(r => score >= r.min && score <= r.max) || RISK_LEVELS[0];
}

function overallRisk(metrics) {
  if (!metrics.length) return RISK_LEVELS[0];
  let maxScore = 0;
  metrics.forEach(m => {
    const s = (m.likelihood || 1) * (m.impact || 1);
    if (s > maxScore) maxScore = s;
  });
  return RISK_LEVELS.slice().reverse().find(r => maxScore >= r.min) || RISK_LEVELS[0];
}

let _counter = 0;
function uid() { return "rm" + (++_counter) + "_" + Math.random().toString(36).slice(2,6); }

const OBJECT_TYPES = ["equipment", "project", "clinical", "software", "financial", "other"];

const DEFAULT_METRICS = [
  { id: uid(), name: "Cell Temperature",       value: "72",  unit: "°C",   likelihood: 3, impact: 4, notes: "Elevated temp in cell block C3" },
  { id: uid(), name: "State of Charge",        value: "15",  unit: "%",    likelihood: 4, impact: 5, notes: "Below minimum safe threshold" },
  { id: uid(), name: "Insulation Resistance",  value: "1.2", unit: "MΩ",   likelihood: 2, impact: 3, notes: "Within spec but degrading" },
  { id: uid(), name: "Cooling Flow",           value: "2.1", unit: "L/min",likelihood: 3, impact: 3, notes: "Reduced since last inspection" },
  { id: uid(), name: "Thermal Runaway Index",  value: "0.31",unit: "",     likelihood: 2, impact: 5, notes: "Early indicator — monitor closely" },
];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class RiskMatrixNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._tooltip = null;

    this.dom = document.createElement("div");
    this.dom.className = "rm-block";
    this._build();
  }

  _patch(fn) {
    const { state, dispatch } = this.view;
    const next = fn(this.node.attrs);
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, next));
  }

  get _readonly() {
    return this.view.props.editable?.() === false;
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    const { title, objectName, objectType, metrics } = this.node.attrs;
    const overall = overallRisk(metrics);

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "rm-header";

    const titleEl = document.createElement("div");
    titleEl.className = "rm-title";

    if (this._readonly) {
      titleEl.innerHTML = `<span class="rm-icon">⚠️</span>
        <span class="rm-title-text">${title}</span>
        <span class="rm-object-badge">${OBJECT_TYPES.includes(objectType) ? objectType : "object"} · ${objectName}</span>`;
    } else {
      const iconEl = document.createElement("span");
      iconEl.className = "rm-icon";
      iconEl.textContent = "⚠️";

      const titleInput = document.createElement("input");
      titleInput.className = "rm-title-input";
      titleInput.value = title;
      titleInput.placeholder = "Assessment title";
      titleInput.addEventListener("blur", () => this._patch(a => ({ ...a, title: titleInput.value })));
      titleInput.addEventListener("keydown", e => { if (e.key === "Enter") titleInput.blur(); });

      const objInput = document.createElement("input");
      objInput.className = "rm-object-input";
      objInput.value = objectName;
      objInput.placeholder = "Object name";
      objInput.addEventListener("blur", () => this._patch(a => ({ ...a, objectName: objInput.value })));
      objInput.addEventListener("keydown", e => { if (e.key === "Enter") objInput.blur(); });

      const typeSelect = document.createElement("select");
      typeSelect.className = "rm-type-select";
      OBJECT_TYPES.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t; opt.textContent = t;
        if (t === objectType) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener("change", () => this._patch(a => ({ ...a, objectType: typeSelect.value })));

      titleEl.append(iconEl, titleInput, objInput, typeSelect);
    }

    // Overall risk badge
    const badge = document.createElement("div");
    badge.className = "rm-overall-badge";
    badge.style.cssText = `background:${overall.bg};color:${overall.text};border-color:${overall.color}`;
    badge.innerHTML = `<span class="rm-badge-dot" style="background:${overall.color}"></span>
      Overall <strong>${overall.label}</strong>`;

    header.append(titleEl, badge);

    // ── Body: metrics list + matrix side by side ─────────────────────────────
    const body = document.createElement("div");
    body.className = "rm-body";

    body.appendChild(this._buildMetricsList(metrics));
    body.appendChild(this._buildMatrix(metrics));

    this.dom.append(header, body);
  }

  // ── Metrics list ─────────────────────────────────────────────────────────

  _buildMetricsList(metrics) {
    const wrap = document.createElement("div");
    wrap.className = "rm-metrics-panel";

    const listTitle = document.createElement("div");
    listTitle.className = "rm-panel-title";
    listTitle.textContent = "METRICS";
    wrap.appendChild(listTitle);

    const list = document.createElement("div");
    list.className = "rm-metrics-list";

    metrics.forEach((m, idx) => {
      const rl = riskLevel(m.likelihood, m.impact);
      const row = document.createElement("div");
      row.className = "rm-metric-row";

      const dot = document.createElement("span");
      dot.className = "rm-metric-dot";
      dot.style.background = rl.color;

      const name = document.createElement("span");
      name.className = "rm-metric-name";
      name.textContent = m.name;

      const val = document.createElement("span");
      val.className = "rm-metric-value";
      val.textContent = m.value ? `${m.value}${m.unit ? " " + m.unit : ""}` : "—";

      const badge = document.createElement("span");
      badge.className = "rm-metric-badge";
      badge.style.cssText = `background:${rl.bg};color:${rl.text};border-color:${rl.color}`;
      badge.textContent = rl.label;

      row.append(dot, name, val, badge);

      if (!this._readonly) {
        const editBtn = document.createElement("button");
        editBtn.className = "rm-icon-btn rm-edit-btn";
        editBtn.title = "Edit metric";
        editBtn.textContent = "✏️";
        editBtn.addEventListener("click", () => this._openMetricEditor(m, idx));

        const delBtn = document.createElement("button");
        delBtn.className = "rm-icon-btn rm-del-btn";
        delBtn.title = "Remove";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", () => {
          this._patch(a => ({ ...a, metrics: a.metrics.filter(x => x.id !== m.id) }));
        });
        row.append(editBtn, delBtn);
      }

      // Tooltip on hover (show notes)
      if (m.notes) {
        row.title = m.notes;
        row.style.cursor = "help";
      }

      list.appendChild(row);
    });

    wrap.appendChild(list);

    if (!this._readonly) {
      const addBtn = document.createElement("button");
      addBtn.className = "rm-add-btn";
      addBtn.textContent = "+ Add metric";
      addBtn.addEventListener("click", () => this._addMetric());
      wrap.appendChild(addBtn);
    }

    return wrap;
  }

  // ── Risk matrix grid ──────────────────────────────────────────────────────

  _buildMatrix(metrics) {
    const wrap = document.createElement("div");
    wrap.className = "rm-matrix-panel";

    const panelTitle = document.createElement("div");
    panelTitle.className = "rm-panel-title";
    panelTitle.innerHTML = `RISK MATRIX <span class="rm-matrix-subtitle">Likelihood × Impact</span>`;
    wrap.appendChild(panelTitle);

    const grid = document.createElement("div");
    grid.className = "rm-grid";

    // Y-axis label
    const yLabel = document.createElement("div");
    yLabel.className = "rm-y-label";
    yLabel.textContent = "Likelihood";
    grid.appendChild(yLabel);

    // Main area: y-axis numbers + cells
    const gridMain = document.createElement("div");
    gridMain.className = "rm-grid-main";

    // Build 5 rows (likelihood 5 → 1, top to bottom)
    for (let l = 5; l >= 1; l--) {
      const rowNum = document.createElement("div");
      rowNum.className = "rm-axis-num";
      rowNum.textContent = l;
      gridMain.appendChild(rowNum);

      for (let i = 1; i <= 5; i++) {
        const cell = document.createElement("div");
        cell.className = "rm-cell";
        cell.style.background = MATRIX_COLORS[l - 1][i - 1];

        // Find metrics that land on this cell
        const hits = metrics.filter(m => m.likelihood === l && m.impact === i);
        hits.forEach((m, hi) => {
          const dot = document.createElement("div");
          dot.className = "rm-matrix-dot";
          const rl = riskLevel(m.likelihood, m.impact);
          dot.style.background = rl.color;
          dot.style.border = "2px solid #fff";
          // Offset multiple dots slightly
          if (hits.length > 1) {
            dot.style.transform = `translate(${(hi - (hits.length-1)/2) * 10}px, 0)`;
          }
          dot.title = `${m.name}${m.value ? ": " + m.value + (m.unit ? " " + m.unit : "") : ""}${m.notes ? "\n" + m.notes : ""}`;
          cell.appendChild(dot);
        });

        gridMain.appendChild(cell);
      }
    }

    // X-axis numbers
    const xAxisSpacer = document.createElement("div"); // spacer for y-axis column
    xAxisSpacer.className = "rm-axis-spacer";
    gridMain.appendChild(xAxisSpacer);
    for (let i = 1; i <= 5; i++) {
      const num = document.createElement("div");
      num.className = "rm-axis-num rm-axis-num--x";
      num.textContent = i;
      gridMain.appendChild(num);
    }

    grid.appendChild(gridMain);

    // X-axis label
    const xLabel = document.createElement("div");
    xLabel.className = "rm-x-label";
    xLabel.textContent = "Impact";
    grid.appendChild(xLabel);

    wrap.appendChild(grid);

    // Legend
    const legend = document.createElement("div");
    legend.className = "rm-legend";
    RISK_LEVELS.forEach(r => {
      const item = document.createElement("div");
      item.className = "rm-legend-item";
      item.innerHTML = `<span class="rm-legend-dot" style="background:${r.color}"></span>${r.label}`;
      legend.appendChild(item);
    });
    wrap.appendChild(legend);

    return wrap;
  }

  // ── Metric editor modal ───────────────────────────────────────────────────

  _addMetric() {
    const blank = { id: uid(), name: "", value: "", unit: "", likelihood: 3, impact: 3, notes: "" };
    this._patch(a => ({ ...a, metrics: [...a.metrics, blank] }));
    // Open editor for the new metric after patch
    setTimeout(() => {
      const metrics = this.node.attrs.metrics;
      const last = metrics[metrics.length - 1];
      if (last) this._openMetricEditor(last, metrics.length - 1);
    }, 50);
  }

  _openMetricEditor(metric, idx) {
    // Remove any existing editor
    this.dom.querySelector(".rm-editor-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "rm-editor-overlay";

    const panel = document.createElement("div");
    panel.className = "rm-editor-panel";

    panel.innerHTML = `<div class="rm-editor-title">Edit Metric</div>`;

    const field = (label, inputEl) => {
      const row = document.createElement("div");
      row.className = "rm-editor-field";
      const lbl = document.createElement("label");
      lbl.className = "rm-editor-label";
      lbl.textContent = label;
      row.append(lbl, inputEl);
      return row;
    };

    const nameIn   = Object.assign(document.createElement("input"), { className:"rm-editor-input", value: metric.name,  placeholder:"e.g. Cell Temperature" });
    const valueIn  = Object.assign(document.createElement("input"), { className:"rm-editor-input rm-editor-input--sm", value: metric.value, placeholder:"85" });
    const unitIn   = Object.assign(document.createElement("input"), { className:"rm-editor-input rm-editor-input--sm", value: metric.unit,  placeholder:"°C" });
    const notesIn  = Object.assign(document.createElement("textarea"), { className:"rm-editor-textarea", value: metric.notes, placeholder:"Optional notes…" });

    // Likelihood slider
    const lSlider = document.createElement("input");
    Object.assign(lSlider, { type:"range", min:1, max:5, step:1, value: metric.likelihood, className:"rm-slider" });
    const lVal = document.createElement("span");
    lVal.className = "rm-slider-val";
    lVal.textContent = metric.likelihood;
    lSlider.addEventListener("input", () => { lVal.textContent = lSlider.value; updatePreview(); });

    const lWrap = document.createElement("div");
    lWrap.className = "rm-slider-wrap";
    lWrap.append(lSlider, lVal);

    // Impact slider
    const iSlider = document.createElement("input");
    Object.assign(iSlider, { type:"range", min:1, max:5, step:1, value: metric.impact, className:"rm-slider" });
    const iVal = document.createElement("span");
    iVal.className = "rm-slider-val";
    iVal.textContent = metric.impact;
    iSlider.addEventListener("input", () => { iVal.textContent = iSlider.value; updatePreview(); });

    const iWrap = document.createElement("div");
    iWrap.className = "rm-slider-wrap";
    iWrap.append(iSlider, iVal);

    // Risk preview badge
    const preview = document.createElement("div");
    preview.className = "rm-editor-preview";

    const updatePreview = () => {
      const rl = riskLevel(+lSlider.value, +iSlider.value);
      preview.textContent = `Score: ${+lSlider.value * +iSlider.value} → `;
      const b = document.createElement("strong");
      b.textContent = rl.label;
      b.style.color = rl.color;
      preview.appendChild(b);
    };
    updatePreview();

    panel.append(
      field("Name",        nameIn),
      field("Value",       valueIn),
      field("Unit",        unitIn),
      field("Likelihood",  lWrap),
      field("Impact",      iWrap),
      field("Risk preview",preview),
      field("Notes",       notesIn),
    );

    // Buttons
    const btnRow = document.createElement("div");
    btnRow.className = "rm-editor-btns";

    const saveBtn = document.createElement("button");
    saveBtn.className = "rm-editor-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      const updated = {
        ...metric,
        name: nameIn.value.trim() || metric.name,
        value: valueIn.value.trim(),
        unit: unitIn.value.trim(),
        likelihood: +lSlider.value,
        impact: +iSlider.value,
        notes: notesIn.value.trim(),
      };
      this._patch(a => ({
        ...a,
        metrics: a.metrics.map(m => m.id === metric.id ? updated : m),
      }));
      overlay.remove();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "rm-editor-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.append(saveBtn, cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    this.dom.appendChild(overlay);
    nameIn.focus();
  }

  // ── ProseMirror interface ─────────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._build();
    return true;
  }

  stopEvent()      { return true; }
  ignoreMutation() { return true; }
}
