/**
 * todoBlock/nodeView.js
 *
 * A ProseMirror NodeView that renders a daily todo list.
 *
 * Features:
 *   • Day navigator — ← prev / Today / next → buttons
 *   • Per-day task list with checkbox, text, priority badge
 *   • Inline add form — type and press Enter
 *   • Click task text → inline edit, Enter/Escape to confirm
 *   • Priority cycle: normal → high → low → normal (click badge)
 *   • Hover task row → × delete button
 *   • Progress bar showing % done for the active day
 *   • Mini calendar strip — last 7 days with dot if tasks exist
 *   • All state stored in ProseMirror attrs → fully undo-able
 */

// ── Tiny helpers ──────────────────────────────────────────────────────────────

let _seq = 0;
const uid   = () => `td_${Date.now()}_${++_seq}`;
const today = () => new Date().toISOString().slice(0, 10);

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.flat(Infinity).filter(Boolean).forEach(c =>
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  );
  return e;
}

function stopAll(node) {
  ["mousedown","click","keydown","pointerdown"].forEach(ev =>
    node.addEventListener(ev, e => e.stopPropagation())
  );
  return node;
}

function btn(cls, html, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = cls; b.innerHTML = html;
  b.addEventListener("mousedown", e => e.preventDefault());
  b.addEventListener("click",     e => { e.stopPropagation(); onClick(e); });
  return b;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  const t = today();
  if (iso === t)             return "Today";
  if (iso === addDays(t,-1)) return "Yesterday";
  if (iso === addDays(t, 1)) return "Tomorrow";
  return new Date(iso + "T00:00:00")
    .toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

function formatShort(iso) {
  return new Date(iso + "T00:00:00")
    .toLocaleDateString(undefined, { weekday:"short", day:"numeric" });
}

// ── Priority meta ─────────────────────────────────────────────────────────────

const PRIORITY = {
  low:    { label:"Low",    color:"#9ca3af", bg:"#f4f4f5", next:"normal" },
  normal: { label:"Normal", color:"#6366f1", bg:"#eef2ff", next:"high"   },
  high:   { label:"High",   color:"#ef4444", bg:"#fee2e2", next:"low"    },
};

// ── NodeView ──────────────────────────────────────────────────────────────────

export class TodoBlockNodeView {
  /**
   * @param {object} opts
   *   readOnly {boolean} — when true (reader view), ProseMirror dispatch is
   *                        bypassed; changes are saved directly to the API.
   *   docId    {string}  — document ID needed for the API call in read-only mode.
   */
  constructor(node, view, getPos, opts = {}) {
    this.node     = node;
    this.view     = view;
    this.getPos   = getPos;
    this.readOnly = opts.readOnly || false;
    this.docId    = opts.docId    || null;

    this.dom = el("div", "todo-block");
    this.dom.contentEditable = "false";
    this._render(node.attrs);
  }

  // ── ProseMirror lifecycle ──────────────────────────────────────────────────

  update(node) {
    if (node.type.name !== "todoBlock") return false;
    this.node = node;
    this._render(node.attrs);
    return true;
  }

  destroy()       { this.dom.innerHTML = ""; }
  stopEvent()     { return true; }
  ignoreMutation(){ return true; }

  // ── Patch helper ─────────────────────────────────────────────────────────
  // In editor mode: dispatch a ProseMirror transaction (picked up by auto-save).
  // In read-only mode: update local node attrs + save directly to the API,
  //   since the view's dispatchTransaction is a no-op when editable=false.

  _patch(patch) {
    const newAttrs = { ...this.node.attrs, ...patch };

    if (this.readOnly) {
      // Optimistic re-render with merged attrs
      this.node = { ...this.node, attrs: newAttrs };
      this._render(newAttrs);
      // Persist via API — PATCH the document's content
      if (this.docId) {
        this._saveToApi(newAttrs).catch(e => console.error("[todoBlock] save failed", e));
      }
      return;
    }

    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, newAttrs)
    );
  }

  async _saveToApi(attrs) {
    // Fetch the current document, splice in updated attrs, PUT it back
    const res  = await fetch(`/api/docs/${this.docId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const row  = await res.json();

    // Walk the doc JSON and update the matching todoBlock node
    const content = JSON.parse(JSON.stringify(row.content));
    let   updated = false;
    const patch   = (nodes) => {
      for (const n of nodes || []) {
        if (n.type === "todoBlock" && !updated) {
          n.attrs  = attrs;
          updated  = true;
        }
        if (n.content) patch(n.content);
      }
    };
    patch(content.content);

    await fetch(`/api/docs/${this.docId}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ content, title: row.title }),
    });
  }

  // ── Immutable day helpers ─────────────────────────────────────────────────

  /** Return attrs with the given date ensured to exist */
  _ensureDay(attrs, date) {
    if (attrs.days.find(d => d.date === date)) return attrs;
    const days = [...attrs.days, { date, tasks: [] }]
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ...attrs, days };
  }

  /** Return a new days array with one task mutated */
  _updateTask(days, date, taskId, taskPatch) {
    return days.map(d =>
      d.date !== date ? d : {
        ...d,
        tasks: d.tasks.map(t =>
          t.id !== taskId ? t : { ...t, ...taskPatch }
        ),
      }
    );
  }

  /** Return a new days array with one task removed */
  _deleteTask(days, date, taskId) {
    return days.map(d =>
      d.date !== date ? d : { ...d, tasks: d.tasks.filter(t => t.id !== taskId) }
    );
  }

  /** Return a new days array with one task appended */
  _appendTask(days, date, task) {
    return days.map(d =>
      d.date !== date ? d : { ...d, tasks: [...d.tasks, task] }
    );
  }

  // ── Full render ───────────────────────────────────────────────────────────

  _render(attrs) {
    this.dom.innerHTML = "";

    const date  = attrs.activeDate || today();
    const day   = attrs.days.find(d => d.date === date) || { date, tasks: [] };
    const tasks = day.tasks;

    // ── Header ────────────────────────────────────────────────────────────
    const hdr = el("div", "todo-hdr");

    hdr.appendChild(
      el("div", "todo-title",
        el("span", "todo-icon", "✅"),
        el("span", "todo-date-label", formatDate(date))
      )
    );

    const nav = el("div", "todo-nav");
    nav.appendChild(btn("todo-nav-btn", "←", () => {
      const attrs2 = this._ensureDay(this.node.attrs, addDays(date, -1));
      this._patch({ activeDate: addDays(date, -1), days: attrs2.days });
    }));
    nav.appendChild(btn("todo-nav-today", "Today", () => {
      const attrs2 = this._ensureDay(this.node.attrs, today());
      this._patch({ activeDate: today(), days: attrs2.days });
    }));
    nav.appendChild(btn("todo-nav-btn", "→", () => {
      const attrs2 = this._ensureDay(this.node.attrs, addDays(date, 1));
      this._patch({ activeDate: addDays(date, 1), days: attrs2.days });
    }));

    hdr.appendChild(nav);
    this.dom.appendChild(hdr);

    // ── Calendar strip (last 7 days) ──────────────────────────────────────
    const strip = el("div", "todo-strip");
    for (let i = -6; i <= 0; i++) {
      const d      = addDays(today(), i);
      const dayObj = attrs.days.find(x => x.date === d);
      const done   = dayObj?.tasks.filter(t => t.done).length || 0;
      const total  = dayObj?.tasks.length || 0;
      const isAct  = d === date;

      const cell = el("div",
        `todo-strip-cell${isAct ? " active" : ""}${d === today() ? " is-today" : ""}`
      );
      cell.title = d;

      const parts  = formatShort(d).split(" ");
      const dotEl  = el("div", "todo-strip-dot");
      if (total > 0) dotEl.style.background = done === total ? "#22c55e" : "#6366f1";

      cell.append(el("div","todo-strip-label", parts[0]), el("div","todo-strip-num", parts[1]), dotEl);
      cell.addEventListener("click", () => {
        const attrs2 = this._ensureDay(this.node.attrs, d);
        this._patch({ activeDate: d, days: attrs2.days });
      });
      strip.appendChild(cell);
    }
    this.dom.appendChild(strip);

    // ── Progress bar ──────────────────────────────────────────────────────
    if (tasks.length > 0) {
      const done  = tasks.filter(t => t.done).length;
      const pct   = Math.round(done / tasks.length * 100);
      const fill  = el("div", "todo-progress-fill");
      fill.style.cssText = `width:${pct}%;background:${pct === 100 ? "#22c55e" : "#6366f1"}`;
      const track = el("div", "todo-progress-track", fill);
      this.dom.appendChild(
        el("div", "todo-progress-wrap", track,
          el("div", "todo-progress-lbl", `${done} / ${tasks.length} done`)
        )
      );
    }

    // ── Task list ─────────────────────────────────────────────────────────
    const list = el("div", "todo-list");
    if (!tasks.length) {
      list.appendChild(el("div", "todo-empty", "No tasks for this day — add one below ↓"));
    } else {
      tasks.forEach(task => list.appendChild(this._buildTaskRow(task, date)));
    }
    this.dom.appendChild(list);

    // ── Add row (editor only) ─────────────────────────────────────────────
    if (!this.readOnly) {
      const addInp = document.createElement("input");
      addInp.type = "text"; addInp.className = "todo-add-input";
      addInp.placeholder = "Add a task… (Enter to save)";
      stopAll(addInp);

      const addBtn = btn("todo-add-btn", "+ Add", () => doAdd());

      const doAdd = () => {
        const text = addInp.value.trim();
        if (!text) return;
        const newTask = { id: uid(), text, done: false, priority: "normal" };
        const attrs2  = this._ensureDay(this.node.attrs, date);
        const newDays = this._appendTask(attrs2.days, date, newTask);
        this._patch({ days: newDays });
        setTimeout(() => this.dom.querySelector(".todo-add-input")?.focus(), 0);
      };

      addInp.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); doAdd(); }
      });

      this.dom.appendChild(el("div", "todo-add-row", addInp, addBtn));
    }
  }

  // ── Single task row ───────────────────────────────────────────────────────

  _buildTaskRow(task, date) {
    const row = el("div", `todo-task-row${task.done ? " done" : ""}`);
    row.dataset.id = task.id;

    // Checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "todo-cb"; cb.checked = task.done;
    stopAll(cb);
    cb.addEventListener("change", () => {
      this._patch({
        days: this._updateTask(this.node.attrs.days, date, task.id, { done: cb.checked }),
      });
    });

    // Text span (click → inline edit, editor only)
    const textEl = el("span", "todo-task-text", task.text);
    if (this.readOnly) textEl.style.cursor = "default";
    textEl.title = this.readOnly ? "" : "Click to edit";
    textEl.addEventListener("click", () => {
      if (this.readOnly) return;
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = "todo-task-edit-input"; inp.value = task.text;
      stopAll(inp);

      const commit = () => {
        const v = inp.value.trim();
        if (v && v !== task.text) {
          this._patch({
            days: this._updateTask(this.node.attrs.days, date, task.id, { text: v }),
          });
        } else {
          // no change — just swap back
          inp.replaceWith(textEl);
        }
      };
      inp.addEventListener("blur",    commit);
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter")  { e.preventDefault(); inp.blur(); }
        if (e.key === "Escape") { inp.value = task.text; inp.blur(); }
      });

      textEl.replaceWith(inp);
      inp.focus(); inp.select();
    });

    // Priority badge (click to cycle)
    const pri   = PRIORITY[task.priority] || PRIORITY.normal;
    const badge = el("span", "todo-pri-badge", pri.label);
    badge.style.cssText = `color:${pri.color};background:${pri.bg}`;
    badge.title = "Click to change priority";
    badge.addEventListener("click", e => {
      e.stopPropagation();
      this._patch({
        days: this._updateTask(this.node.attrs.days, date, task.id, { priority: pri.next }),
      });
    });

    // Delete button (editor only)
    const delBtn = this.readOnly ? null : btn("todo-del-btn",
      `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`,
      () => {
        if (!confirm("Delete this task?")) return;
        this._patch({
          days: this._deleteTask(this.node.attrs.days, date, task.id),
        });
      }
    );

    row.append(cb, textEl, badge, ...(delBtn ? [delBtn] : []));
    return row;
  }
}
