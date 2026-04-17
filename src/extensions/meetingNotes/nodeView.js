/**
 * MeetingNotesNodeView
 *
 * Structured meeting record with four interactive sections:
 *   1. Header  — title (editable), date/time picker, location
 *   2. Attendees — pill list, click to toggle present/absent, add/remove
 *   3. Agenda   — ordered checklist, add/remove, check off items
 *   4. Action items — table with owner, due date, cycling status badge
 *   5. Notes    — free-form textarea (patched on blur)
 *
 * All data lives in ProseMirror node attrs (JSON-serialisable).
 * Edits flow: DOM event → _patch(fn) → setNodeMarkup → update() → _build()
 */

import { randomId } from "../../store/docStore.js";

// ── Status cycle ──────────────────────────────────────────────────────────────
const STATUS_NEXT = { open: "in-progress", "in-progress": "done", done: "open" };
const STATUS_STYLE = {
  open:          { bg: "#f1f5f9", color: "#64748b", label: "Open"        },
  "in-progress": { bg: "#fef3c7", color: "#d97706", label: "In progress" },
  done:          { bg: "#d1fae5", color: "#059669", label: "Done"        },
};

// ── NodeView ──────────────────────────────────────────────────────────────────
export class MeetingNotesNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "mn-block";
    this._build();
  }

  // Functional-updater _patch — same pattern as Kanban
  _patch(patch) {
    const { state, dispatch } = this.view;
    const cur      = this.node.attrs;
    const resolved = typeof patch === "function" ? patch(cur) : patch;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...cur, ...resolved }));
  }

  _build() {
    this.dom.innerHTML = "";
    this._renderHeader();
    this._renderAttendees();
    this._renderAgenda();
    this._renderActions();
    this._renderNotes();
  }

  // ── 1. Header ───────────────────────────────────────────────────────────────
  _renderHeader() {
    const { title, date, location } = this.node.attrs;
    const sec = el("div", "mn-header");
    sec.innerHTML = `
      <div class="mn-header-left">
        <div class="mn-hdr-icon">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="3" width="18" height="16" rx="3" stroke="#4f46e5" stroke-width="1.6"/>
            <path d="M7 1v4M15 1v4" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M2 9h18" stroke="#4f46e5" stroke-width="1.2"/>
            <path d="M6 14h5M6 17.5h10" stroke="#4f46e5" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </div>
        <input class="mn-title-inp" type="text" value="${ea(title)}" placeholder="Meeting title…" spellcheck="false"/>
      </div>
      <div class="mn-header-meta">
        <label class="mn-meta-row">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="1" y="2" width="11" height="10" rx="2" stroke="#94a3b8" stroke-width="1.2"/>
            <path d="M4 1v2M9 1v2M1 5.5h11" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <input class="mn-meta-inp mn-meta-inp--date" type="datetime-local" value="${ea(date)}"/>
        </label>
        <label class="mn-meta-row">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1C4.567 1 3 2.567 3 4.5 3 7.5 6.5 12 6.5 12S10 7.5 10 4.5C10 2.567 8.433 1 6.5 1z" stroke="#94a3b8" stroke-width="1.2"/>
            <circle cx="6.5" cy="4.5" r="1.5" stroke="#94a3b8" stroke-width="1.2"/>
          </svg>
          <input class="mn-meta-inp" type="text" value="${ea(location)}" placeholder="Location or link…"/>
        </label>
      </div>`;

    // Title: patch on blur / Enter
    const titleInp = sec.querySelector(".mn-title-inp");
    on(titleInp, "blur", () => {
      if (titleInp.value !== this.node.attrs.title)
        this._patch({ title: titleInp.value });
    });
    on(titleInp, "keydown", e => { if (e.key === "Enter") { e.preventDefault(); titleInp.blur(); } });

    // Date: patch on change
    const dateInp = sec.querySelector(".mn-meta-inp--date");
    on(dateInp, "change", () => this._patch({ date: dateInp.value }));

    // Location: patch on blur / Enter
    const locInp = sec.querySelectorAll(".mn-meta-inp")[1];
    on(locInp, "blur",   () => { if (locInp.value !== this.node.attrs.location) this._patch({ location: locInp.value }); });
    on(locInp, "keydown", e => { if (e.key === "Enter") { e.preventDefault(); locInp.blur(); } });

    this.dom.appendChild(sec);
  }

  // ── 2. Attendees ─────────────────────────────────────────────────────────────
  _renderAttendees() {
    const { attendees = [] } = this.node.attrs;
    const sec = el("div", "mn-section");

    const present = attendees.filter(a => a.present).length;
    sec.innerHTML = `
      <div class="mn-sec-hdr">
        <span class="mn-sec-title">Attendees</span>
        <span class="mn-sec-badge">${present}/${attendees.length} present</span>
        <span class="mn-sec-gap"></span>
        <button class="mn-add-btn" data-act="add-att">+ Add</button>
      </div>
      <div class="mn-chips">
        ${attendees.length === 0
          ? `<span class="mn-empty">No attendees yet — add someone ↑</span>`
          : attendees.map(a => this._attChip(a)).join("")}
      </div>`;

    // Toggle present
    sec.querySelectorAll(".mn-att-toggle").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({ attendees: c.attendees.map(a => a.id === id ? { ...a, present: !a.present } : a) }));
      })
    );
    // Remove
    sec.querySelectorAll(".mn-att-del").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({ attendees: c.attendees.filter(a => a.id !== id) }));
      })
    );
    // Add form
    on(sec.querySelector("[data-act='add-att']"), "click", () => this._addAttForm(sec));

    this.dom.appendChild(sec);
  }

  _attChip(a) {
    const bg  = hueColor(a.name, 88);
    const fg  = hueColor(a.name, 32);
    const ini = initials(a.name);
    return `
      <div class="mn-chip ${a.present ? "" : "mn-chip--absent"}">
        <div class="mn-chip-av" style="background:${bg};color:${fg}">${ini}</div>
        <div class="mn-chip-info">
          <div class="mn-chip-name">${eh(a.name)}</div>
          ${a.role ? `<div class="mn-chip-role">${eh(a.role)}</div>` : ""}
        </div>
        <button class="mn-att-toggle ${a.present ? "mn-att-toggle--yes" : "mn-att-toggle--no"}"
          data-id="${a.id}" title="${a.present ? "Mark absent" : "Mark present"}">
          ${a.present ? checkIcon() : crossIcon()}
        </button>
        <button class="mn-att-del" data-id="${a.id}" title="Remove">×</button>
      </div>`;
  }

  _addAttForm(sec) {
    if (sec.querySelector(".mn-inline-form")) return;
    const form = el("div", "mn-inline-form");
    form.innerHTML = `
      <input class="mn-fi" type="text"   placeholder="Full name"       style="width:130px"/>
      <input class="mn-fi" type="text"   placeholder="Role (optional)" style="width:120px"/>
      <button class="mn-fi-ok">Add</button>
      <button class="mn-fi-cancel">Cancel</button>`;
    sec.querySelector(".mn-chips").appendChild(form);
    form.querySelector(".mn-fi").focus();

    const confirm = () => {
      const [nameI, roleI] = form.querySelectorAll(".mn-fi");
      const name = nameI.value.trim();
      if (!name) return;
      this._patch(c => ({ attendees: [...c.attendees, { id: randomId(), name, role: roleI.value.trim(), present: true }] }));
    };
    on(form.querySelector(".mn-fi-ok"),     "click",  confirm);
    on(form.querySelector(".mn-fi-cancel"), "click",  () => form.remove());
    on(form.querySelector(".mn-fi"),        "keydown", e => {
      if (e.key === "Enter")  confirm();
      if (e.key === "Escape") form.remove();
    });
  }

  // ── 3. Agenda ────────────────────────────────────────────────────────────────
  _renderAgenda() {
    const { agenda = [] } = this.node.attrs;
    const done = agenda.filter(i => i.done).length;
    const sec  = el("div", "mn-section");

    sec.innerHTML = `
      <div class="mn-sec-hdr">
        <span class="mn-sec-title">Agenda</span>
        <span class="mn-sec-badge">${done}/${agenda.length} done</span>
        <span class="mn-sec-gap"></span>
        <button class="mn-add-btn" data-act="add-ag">+ Add item</button>
      </div>
      <div class="mn-agenda">
        ${agenda.length === 0
          ? `<span class="mn-empty">No agenda items — add one ↑</span>`
          : agenda.map((item, i) => `
            <div class="mn-ag-row ${item.done ? "mn-ag-row--done" : ""}">
              <span class="mn-ag-num">${i + 1}.</span>
              <button class="mn-ag-chk" data-id="${item.id}" title="Toggle done">
                ${item.done ? checkedBox() : emptyBox()}
              </button>
              <span class="mn-ag-text">${eh(item.text)}</span>
              <button class="mn-ag-del" data-id="${item.id}" title="Remove">×</button>
            </div>`).join("")}
      </div>`;

    sec.querySelectorAll(".mn-ag-chk").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({ agenda: c.agenda.map(a => a.id === id ? { ...a, done: !a.done } : a) }));
      })
    );
    sec.querySelectorAll(".mn-ag-del").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({ agenda: c.agenda.filter(a => a.id !== id) }));
      })
    );
    on(sec.querySelector("[data-act='add-ag']"), "click", () => this._addAgendaForm(sec));

    this.dom.appendChild(sec);
  }

  _addAgendaForm(sec) {
    if (sec.querySelector(".mn-inline-form")) return;
    const form = el("div", "mn-inline-form");
    form.innerHTML = `
      <input class="mn-fi mn-fi--wide" type="text" placeholder="Agenda item…"/>
      <button class="mn-fi-ok">Add</button>
      <button class="mn-fi-cancel">Cancel</button>`;
    sec.querySelector(".mn-agenda").appendChild(form);
    form.querySelector(".mn-fi").focus();

    const confirm = () => {
      const inp  = form.querySelector(".mn-fi");
      const text = inp.value.trim();
      if (!text) return;
      this._patch(c => ({ agenda: [...c.agenda, { id: randomId(), text, done: false }] }));
    };
    on(form.querySelector(".mn-fi-ok"),     "click",  confirm);
    on(form.querySelector(".mn-fi-cancel"), "click",  () => form.remove());
    on(form.querySelector(".mn-fi"),        "keydown", e => {
      if (e.key === "Enter")  confirm();
      if (e.key === "Escape") form.remove();
    });
  }

  // ── 4. Action items ──────────────────────────────────────────────────────────
  _renderActions() {
    const { actions = [], attendees = [] } = this.node.attrs;
    const open = actions.filter(a => a.status !== "done").length;
    const sec  = el("div", "mn-section");

    sec.innerHTML = `
      <div class="mn-sec-hdr">
        <span class="mn-sec-title">Action items</span>
        <span class="mn-sec-badge">${open} open</span>
        <span class="mn-sec-gap"></span>
        <button class="mn-add-btn" data-act="add-act">+ Add</button>
      </div>
      <div class="mn-actions">
        ${actions.length === 0
          ? `<span class="mn-empty">No action items — add one ↑</span>`
          : `<div class="mn-act-thead">
               <span>Task</span><span>Owner</span><span>Due</span><span>Status</span><span></span>
             </div>` + actions.map(item => {
               const st = STATUS_STYLE[item.status] || STATUS_STYLE.open;
               return `
                 <div class="mn-act-row ${item.status === "done" ? "mn-act-row--done" : ""}">
                   <span class="mn-act-text">${eh(item.text)}</span>
                   <span class="mn-act-owner">${eh(item.owner || "—")}</span>
                   <span class="mn-act-due">${item.due ? fmtDate(item.due) : "—"}</span>
                   <button class="mn-act-status" data-id="${item.id}"
                     style="background:${st.bg};color:${st.color}">${st.label}</button>
                   <button class="mn-act-del" data-id="${item.id}" title="Remove">×</button>
                 </div>`;
             }).join("")}
      </div>`;

    // Cycle status on click
    sec.querySelectorAll(".mn-act-status").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({
          actions: c.actions.map(a => a.id === id ? { ...a, status: STATUS_NEXT[a.status] || "open" } : a)
        }));
      })
    );
    sec.querySelectorAll(".mn-act-del").forEach(btn =>
      on(btn, "click", () => {
        const id = btn.dataset.id;
        this._patch(c => ({ actions: c.actions.filter(a => a.id !== id) }));
      })
    );
    on(sec.querySelector("[data-act='add-act']"), "click", () => this._addActionForm(sec, attendees));

    this.dom.appendChild(sec);
  }

  _addActionForm(sec, attendees) {
    if (sec.querySelector(".mn-inline-form")) return;
    const ownerOpts = attendees.map(a =>
      `<option value="${ea(a.name)}">${eh(a.name)}</option>`
    ).join("");

    const form = el("div", "mn-inline-form mn-inline-form--action");
    form.innerHTML = `
      <input  class="mn-fi mn-fi--wide" type="text" placeholder="Action item…"/>
      <select class="mn-fi mn-fi-sel">
        <option value="">Owner…</option>
        ${ownerOpts}
        <option value="__other__">Other…</option>
      </select>
      <input class="mn-fi mn-fi-owner-custom mn-hidden" type="text" placeholder="Name…" style="width:100px"/>
      <input class="mn-fi" type="date" style="width:130px"/>
      <button class="mn-fi-ok">Add</button>
      <button class="mn-fi-cancel">Cancel</button>`;

    sec.querySelector(".mn-actions").appendChild(form);
    form.querySelector(".mn-fi").focus();

    const sel        = form.querySelector(".mn-fi-sel");
    const customInp  = form.querySelector(".mn-fi-owner-custom");
    on(sel, "change", () => {
      const isOther = sel.value === "__other__";
      customInp.classList.toggle("mn-hidden", !isOther);
      if (isOther) customInp.focus();
    });

    const confirm = () => {
      const text = form.querySelector(".mn-fi").value.trim();
      if (!text) return;
      const owner = sel.value === "__other__" ? customInp.value.trim() : sel.value;
      const due   = form.querySelectorAll(".mn-fi")[3]?.value || "";
      this._patch(c => ({
        actions: [...c.actions, { id: randomId(), text, owner, due, status: "open" }]
      }));
    };
    on(form.querySelector(".mn-fi-ok"),     "click",  confirm);
    on(form.querySelector(".mn-fi-cancel"), "click",  () => form.remove());
    on(form.querySelector(".mn-fi"),        "keydown", e => {
      if (e.key === "Enter")  confirm();
      if (e.key === "Escape") form.remove();
    });
  }

  // ── 5. Notes ─────────────────────────────────────────────────────────────────
  _renderNotes() {
    const { notes = "" } = this.node.attrs;
    const sec = el("div", "mn-section mn-section--notes");
    sec.innerHTML = `
      <div class="mn-sec-hdr">
        <span class="mn-sec-title">Notes</span>
      </div>
      <textarea class="mn-notes" rows="4"
        placeholder="Free-form notes, decisions, context…">${eh(notes)}</textarea>`;

    const ta = sec.querySelector(".mn-notes");
    on(ta, "blur",   () => { if (ta.value !== this.node.attrs.notes) this._patch({ notes: ta.value }); });
    on(ta, "keydown", e => { if (e.key === "Escape") ta.blur(); });

    this.dom.appendChild(sec);
  }

  // ── ProseMirror NodeView interface ───────────────────────────────────────────
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

// ── Micro helpers ─────────────────────────────────────────────────────────────

function el(tag, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}
function on(el, ev, fn) { el?.addEventListener(ev, fn); }

function eh(s)  { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function ea(s)  { return String(s ?? "").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

function initials(name = "") {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
function hueColor(s = "", l = 80) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360},60%,${l}%)`;
}
function fmtDate(iso) {
  try { return new Date(iso + "T00:00").toLocaleDateString(undefined, { month:"short", day:"numeric" }); }
  catch { return iso; }
}

function checkIcon()  { return `<svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14" rx="3.5" fill="#4f46e5"/><path d="M3 7l3 3 5-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function crossIcon()  { return `<svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14" rx="3.5" fill="#fee2e2"/><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function checkedBox() { return `<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#4f46e5"/><path d="M4 8l3 3 5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function emptyBox()   { return `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="0.8" y="0.8" width="14.4" height="14.4" rx="3.5" fill="none" stroke="#d1d5db" stroke-width="1.4"/></svg>`; }
