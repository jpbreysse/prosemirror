/**
 * MaintenanceBlockNodeView
 *
 * A maintenance schedule table embedded in a ProseMirror document.
 *
 * Features:
 *  • Tasks linked to components (picked from BOM blocks in the same doc)
 *  • Status auto-computed: overdue / upcoming / planned / done
 *  • Click status pill to toggle done ↔ planned
 *  • Double-click any cell to edit inline
 *  • "+ Add task" opens an inline form with a BOM component picker
 *  • Interval in days → shown as human label (monthly, quarterly…)
 *  • Summary bar: N tasks this month · N overdue
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function uid() { return `mt-${Date.now()}-${++_seq}`; }

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

function computeStatus(task) {
  if (task.status === "done") return "done";
  if (!task.scheduled_date)   return "planned";
  const d = new Date(task.scheduled_date);
  if (d < TODAY) return "overdue";
  const soon = new Date(TODAY); soon.setDate(soon.getDate() + 14);
  if (d <= soon)  return "upcoming";
  return "planned";
}

const STATUS_LABEL = { done: "Done", overdue: "Overdue", upcoming: "Soon", planned: "Planned" };
const STATUS_CLASS = { done: "mt-pill--done", overdue: "mt-pill--overdue", upcoming: "mt-pill--upcoming", planned: "mt-pill--planned" };

const TASK_TYPES = ["Inspection","Replacement","Lubrication","Cleaning","Calibration","Tightening","Other"];

const INTERVALS = [
  { days: 7,   label: "Weekly"    },
  { days: 30,  label: "Monthly"   },
  { days: 90,  label: "Quarterly" },
  { days: 180, label: "6 months"  },
  { days: 365, label: "Annual"    },
];
function intervalLabel(days) {
  const found = INTERVALS.find(i => i.days === days);
  return found ? found.label : days ? `${days}d` : "—";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

// Scan the current doc for bomBlock nodes → collect all leaf+branch components
function collectBomComponents(view) {
  const results = [];
  view.state.doc.forEach(node => {
    if (node.type.name !== "bomBlock") return;
    const tree = node.attrs.tree;
    if (!tree) return;
    function walk(n, path) {
      const fullPath = path ? `${path} › ${n.name}` : n.name;
      // include every non-root node
      if (path !== "") results.push({ id: n.id, name: n.name, path: fullPath });
      for (const c of n.children ?? []) walk(c, fullPath);
    }
    walk(tree, "");
  });
  return results;
}

// ── NodeView ──────────────────────────────────────────────────────────────────

export class MaintenanceBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._adding = false;

    this.dom = document.createElement("div");
    this.dom.className = "mt-block";
    this._build();
  }

  _commit(tasks) {
    const tr = this.view.state.tr.setNodeMarkup(
      this.getPos(), null, { ...this.node.attrs, tasks }
    );
    this.view.dispatch(tr);
  }

  _build() {
    const { title, tasks } = this.node.attrs;
    this.dom.innerHTML = "";

    // ── Header ─────────────────────────────────────────────────────────────
    const hdr = document.createElement("div");
    hdr.className = "mt-header";

    const icon = `<span class="mt-header-icon"><svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 4.5v3.8l2.5 1.5" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg></span>`;

    const titleEl = document.createElement("span");
    titleEl.className = "mt-header-title";
    titleEl.textContent = title;
    titleEl.title = "Double-click to rename";
    titleEl.addEventListener("dblclick", () => this._editTitle());

    const summary = this._buildSummary(tasks);

    const addBtn = document.createElement("button");
    addBtn.className = "mt-add-btn";
    addBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg> Add task`;
    addBtn.addEventListener("click", () => this._openAddForm());

    hdr.innerHTML = icon;
    hdr.appendChild(titleEl);
    hdr.appendChild(summary);
    hdr.appendChild(addBtn);
    this.dom.appendChild(hdr);

    // ── Task table ──────────────────────────────────────────────────────────
    if (tasks.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "mt-table-wrap";

      const table = document.createElement("table");
      table.className = "mt-table";
      table.innerHTML = `<thead><tr>
        <th class="mt-col-component">Component</th>
        <th class="mt-col-type">Task</th>
        <th class="mt-col-date">Scheduled</th>
        <th class="mt-col-interval">Interval</th>
        <th class="mt-col-status">Status</th>
        <th class="mt-col-actions"></th>
      </tr></thead>`;

      const tbody = document.createElement("tbody");
      tasks.forEach(task => this._renderRow(tbody, task));
      table.appendChild(tbody);
      wrap.appendChild(table);
      this.dom.appendChild(wrap);
    } else {
      const empty = document.createElement("div");
      empty.className = "mt-empty";
      empty.textContent = "No tasks yet — click \"Add task\" to schedule maintenance.";
      this.dom.appendChild(empty);
    }

    // ── Add form (if open) ──────────────────────────────────────────────────
    if (this._adding) this._renderAddForm();
  }

  _buildSummary(tasks) {
    const el = document.createElement("span");
    el.className = "mt-summary";
    if (!tasks.length) { el.textContent = "No tasks"; return el; }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const thisMonth = tasks.filter(t => {
      if (!t.scheduled_date) return false;
      const d = new Date(t.scheduled_date);
      return d >= monthStart && d <= monthEnd;
    }).length;

    const overdue = tasks.filter(t => computeStatus(t) === "overdue").length;

    const parts = [];
    if (thisMonth) parts.push(`${thisMonth} this month`);
    if (overdue)   parts.push(`<span class="mt-summary-overdue">${overdue} overdue</span>`);
    if (!parts.length) parts.push(`${tasks.length} task${tasks.length !== 1 ? "s" : ""}`);

    el.innerHTML = parts.join(" · ");
    return el;
  }

  // ── Render a single task row ───────────────────────────────────────────────

  _renderRow(tbody, task) {
    const status = computeStatus(task);
    const tr = document.createElement("tr");
    tr.className = "mt-row mt-row--" + status;
    tr.dataset.id = task.id;

    // Component
    const tdComp = document.createElement("td");
    tdComp.className = "mt-td-component";
    const compSpan = document.createElement("span");
    compSpan.className = "mt-cell-text";
    compSpan.textContent = task.component_name || "—";
    compSpan.title = "Double-click to edit";
    compSpan.addEventListener("dblclick", () =>
      this._editCell(task.id, "component_name", compSpan)
    );
    tdComp.appendChild(compSpan);

    // Task type
    const tdType = document.createElement("td");
    tdType.className = "mt-td-type";
    const typeSpan = document.createElement("span");
    typeSpan.className = "mt-cell-text mt-type-label";
    typeSpan.textContent = task.task_type || "—";
    typeSpan.title = "Double-click to edit";
    typeSpan.addEventListener("dblclick", () =>
      this._editSelect(task.id, "task_type", typeSpan, TASK_TYPES)
    );
    tdType.appendChild(typeSpan);

    // Date
    const tdDate = document.createElement("td");
    tdDate.className = "mt-td-date";
    const dateSpan = document.createElement("span");
    dateSpan.className = "mt-cell-text";
    dateSpan.textContent = formatDate(task.scheduled_date);
    dateSpan.title = "Double-click to edit";
    dateSpan.addEventListener("dblclick", () =>
      this._editDate(task.id, dateSpan)
    );
    tdDate.appendChild(dateSpan);

    // Interval
    const tdInt = document.createElement("td");
    tdInt.className = "mt-td-interval";
    const intSpan = document.createElement("span");
    intSpan.className = "mt-cell-text mt-interval-label";
    intSpan.textContent = intervalLabel(task.interval_days);
    intSpan.title = "Double-click to edit";
    intSpan.addEventListener("dblclick", () =>
      this._editSelect(task.id, "interval_days", intSpan,
        INTERVALS.map(i => ({ value: i.days, label: i.label }))
      )
    );
    tdInt.appendChild(intSpan);

    // Status pill
    const tdStatus = document.createElement("td");
    tdStatus.className = "mt-td-status";
    const pill = document.createElement("span");
    pill.className = `mt-pill ${STATUS_CLASS[status]}`;
    pill.textContent = STATUS_LABEL[status];
    pill.title = status === "done" ? "Click to mark as planned" : "Click to mark as done";
    pill.addEventListener("click", () => {
      const tasks = deepClone(this.node.attrs.tasks);
      const t = tasks.find(t => t.id === task.id);
      if (t) { t.status = t.status === "done" ? "planned" : "done"; this._commit(tasks); }
    });
    tdStatus.appendChild(pill);

    // Actions
    const tdAct = document.createElement("td");
    tdAct.className = "mt-td-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "mt-del-btn";
    delBtn.title = "Delete task";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      const tasks = deepClone(this.node.attrs.tasks).filter(t => t.id !== task.id);
      this._commit(tasks);
    });
    tdAct.appendChild(delBtn);

    tr.append(tdComp, tdType, tdDate, tdInt, tdStatus, tdAct);
    tbody.appendChild(tr);
  }

  // ── Inline text edit ───────────────────────────────────────────────────────

  _editCell(id, field, span) {
    const input = document.createElement("input");
    input.className = "mt-inline-input";
    input.value = span.textContent === "—" ? "" : span.textContent;
    span.replaceWith(input);
    input.focus(); input.select();

    const commit = () => {
      const tasks = deepClone(this.node.attrs.tasks);
      const t = tasks.find(t => t.id === id);
      if (t) { t[field] = input.value.trim() || span.textContent; this._commit(tasks); }
      else this._build();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); this._build(); }
    });
  }

  _editSelect(id, field, span, options) {
    const sel = document.createElement("select");
    sel.className = "mt-inline-select";
    options.forEach(opt => {
      const o = document.createElement("option");
      const isObj = typeof opt === "object";
      o.value  = isObj ? opt.value : opt;
      o.text   = isObj ? opt.label : opt;
      if (String(o.value) === String(span.dataset.value ?? span.textContent)) o.selected = true;
      sel.appendChild(o);
    });
    span.replaceWith(sel);
    sel.focus();

    const commit = () => {
      const tasks = deepClone(this.node.attrs.tasks);
      const t = tasks.find(t => t.id === id);
      if (t) {
        const val = sel.value;
        t[field] = isNaN(val) ? val : Number(val);
        this._commit(tasks);
      } else this._build();
    };
    sel.addEventListener("change", commit);
    sel.addEventListener("blur",   () => setTimeout(commit, 100));
  }

  _editDate(id, span) {
    const input = document.createElement("input");
    input.className = "mt-inline-input";
    input.type  = "date";
    const tasks = this.node.attrs.tasks;
    const task  = tasks.find(t => t.id === id);
    if (task?.scheduled_date) input.value = task.scheduled_date;
    span.replaceWith(input);
    input.focus();

    const commit = () => {
      const ts = deepClone(this.node.attrs.tasks);
      const t  = ts.find(t => t.id === id);
      if (t) { t.scheduled_date = input.value || null; this._commit(ts); }
      else this._build();
    };
    input.addEventListener("blur",   commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); this._build(); }
    });
  }

  // ── Edit block title ───────────────────────────────────────────────────────

  _editTitle() {
    const titleEl = this.dom.querySelector(".mt-header-title");
    if (!titleEl) return;
    const input = document.createElement("input");
    input.className = "mt-title-input";
    input.value = this.node.attrs.title;
    titleEl.replaceWith(input);
    input.focus(); input.select();

    const commit = () => {
      const tr = this.view.state.tr.setNodeMarkup(
        this.getPos(), null,
        { ...this.node.attrs, title: input.value.trim() || this.node.attrs.title }
      );
      this.view.dispatch(tr);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); this._build(); }
    });
  }

  // ── Add task form ──────────────────────────────────────────────────────────

  _openAddForm() {
    this._adding = true;
    this._build();
    this.dom.querySelector(".mt-form-component")?.focus();
  }

  _renderAddForm() {
    const components = collectBomComponents(this.view);
    const tomorrow   = new Date(TODAY); tomorrow.setDate(tomorrow.getDate() + 1);
    const isoTomorrow = tomorrow.toISOString().slice(0, 10);

    const form = document.createElement("div");
    form.className = "mt-add-form";
    form.innerHTML = `
      <div class="mt-form-title">New maintenance task</div>
      <div class="mt-form-row">
        <label class="mt-form-label">Component
          ${components.length
            ? `<select class="mt-form-input mt-form-component">
                 <option value="">— type or pick from BOM —</option>
                 ${components.map(c =>
                   `<option value="${escHtml(c.id)}" data-name="${escHtml(c.name)}">${escHtml(c.path)}</option>`
                 ).join("")}
               </select>`
            : `<input class="mt-form-input mt-form-component" placeholder="e.g. Oil filter" />`
          }
        </label>
        <label class="mt-form-label">Task type
          <select class="mt-form-input mt-form-type">
            ${TASK_TYPES.map(t => `<option>${escHtml(t)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="mt-form-row">
        <label class="mt-form-label">Scheduled date
          <input type="date" class="mt-form-input mt-form-date" value="${isoTomorrow}" />
        </label>
        <label class="mt-form-label">Interval
          <select class="mt-form-input mt-form-interval">
            ${INTERVALS.map(i => `<option value="${i.days}">${escHtml(i.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="mt-form-actions">
        <button class="mt-form-submit">Add task</button>
        <button class="mt-form-cancel">Cancel</button>
      </div>`;

    form.querySelector(".mt-form-submit").addEventListener("click", () => {
      const compEl    = form.querySelector(".mt-form-component");
      const typeEl    = form.querySelector(".mt-form-type");
      const dateEl    = form.querySelector(".mt-form-date");
      const intervalEl= form.querySelector(".mt-form-interval");

      let component_name = "";
      let component_id   = "";

      if (compEl.tagName === "SELECT") {
        const opt = compEl.options[compEl.selectedIndex];
        component_id   = opt.value;
        component_name = opt.dataset.name || opt.text;
        // If user selected the placeholder, use text as name
        if (!component_id) component_name = compEl.value.trim();
      } else {
        component_name = compEl.value.trim();
      }

      if (!component_name && !component_id) {
        compEl.classList.add("mt-form-invalid");
        compEl.focus();
        return;
      }

      const newTask = {
        id:             uid(),
        component_id,
        component_name,
        task_type:      typeEl.value,
        scheduled_date: dateEl.value || null,
        interval_days:  Number(intervalEl.value),
        status:         "planned",
      };

      const tasks = [...deepClone(this.node.attrs.tasks), newTask];
      this._adding = false;
      this._commit(tasks);
    });

    form.querySelector(".mt-form-cancel").addEventListener("click", () => {
      this._adding = false;
      this._build();
    });

    this.dom.appendChild(form);
    setTimeout(() => form.querySelector(".mt-form-component")?.focus(), 30);
  }

  // ── ProseMirror hooks ──────────────────────────────────────────────────────

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
