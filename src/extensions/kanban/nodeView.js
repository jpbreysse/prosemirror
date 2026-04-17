/**
 * extensions/kanban/nodeView.js
 *
 * A ProseMirror NodeView that renders a full Jira-like Kanban board.
 *
 * Features:
 *   • Columns with colour-coded headers and issue count badges
 *   • Issue cards with priority badge, title, assignee and labels
 *   • HTML5 drag-and-drop to move cards between columns
 *   • "+ Add issue" inline quick-add form per column
 *   • Click a card → slide-in detail panel (edit all fields + delete)
 *   • Add / rename / delete columns via board toolbar
 *   • All state lives in ProseMirror attrs → fully undo-able
 */

import { docStore, randomId } from "../../store/docStore.js";
import { buildIssueEditor }  from "./issueEditor.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
const uid = () => `k${Date.now()}_${++_seq}`;

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.flat(Infinity).filter(Boolean).forEach(c =>
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  );
  return e;
}

function btn(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("mousedown", e => e.preventDefault());
  b.addEventListener("click",     e => { e.stopPropagation(); onClick(e); });
  return b;
}

function inp(cls, value, placeholder = "", type = "text") {
  const i = document.createElement("input");
  i.className = cls; i.type = type;
  i.value = value ?? ""; i.placeholder = placeholder;
  ["mousedown","click","keydown"].forEach(ev =>
    i.addEventListener(ev, e => e.stopPropagation())
  );
  return i;
}

function stopAll(node) {
  ["mousedown","click","keydown"].forEach(ev =>
    node.addEventListener(ev, e => e.stopPropagation())
  );
  return node;
}

// ── Priority meta ─────────────────────────────────────────────────────────────

const PRIORITY = {
  urgent: { icon: "🔴", label: "Urgent", color: "#ef4444" },
  high:   { icon: "🟠", label: "High",   color: "#f97316" },
  medium: { icon: "🟡", label: "Medium", color: "#eab308" },
  low:    { icon: "🔵", label: "Low",    color: "#3b82f6" },
  none:   { icon: "⚪", label: "None",   color: "#d4d4d8" },
};
const PRIORITIES = ["urgent","high","medium","low","none"];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class KanbanNodeView {
  constructor(node, view, getPos) {
    this.node    = node;
    this.view    = view;
    this.getPos  = getPos;
    this._draggingId  = null;   // issue id being dragged
    this._detailId    = null;   // issue id shown in detail panel
    this._quickAddCol = null;   // column id with open quick-add
    this._issuePanel  = null;   // active issue editor DOM panel

    this.dom = el("div", "kanban-node");
    this.dom.contentEditable = "false";
    this._render(node.attrs);
  }

  // ── Full render ───────────────────────────────────────────────────

  _render(attrs) {
    this.dom.innerHTML = "";

    // ── Board header ────────────────────────────────────────────
    const header = el("div", "kanban-header");
    const titleInp = inp("kanban-board-title", attrs.title, "Board title…");
    titleInp.addEventListener("input", () =>
      this._patch({ title: titleInp.value })
    );
    header.appendChild(titleInp);

    // Add column button
    header.appendChild(btn("kanban-add-col-btn", "+ Add column", () => {
      const id = uid();
      const colors = ["#fce7f3","#ede9fe","#fef3c7","#d1fae5","#e0f2fe"];
      const color  = colors[attrs.columns.length % colors.length];
      this._patch({
        columns: [...attrs.columns, { id, title: "New Column", color }],
      });
    }));
    this.dom.appendChild(header);

    // ── Columns ────────────────────────────────────────────────
    const board = el("div", "kanban-board");

    attrs.columns.forEach(col => {
      const colIssues = attrs.issues.filter(i => i.columnId === col.id);
      board.appendChild(this._buildColumn(col, colIssues, attrs));
    });

    this.dom.appendChild(board);

    // ── Issue editor panel (if open) ───────────────────────────
    if (this._detailId) {
      const issue = attrs.issues.find(i => i.id === this._detailId);
      if (issue) this._renderIssueEditor(issue, attrs);
    }
  }

  // ── Column ────────────────────────────────────────────────────

  _buildColumn(col, issues, attrs) {
    const wrap = el("div", "kanban-column");
    wrap.dataset.colId = col.id;

    // Column header
    const header = el("div", "kanban-col-header");
    header.style.borderTopColor = col.color;

    const dot = el("div", "kanban-col-dot");
    dot.style.background = col.color;

    const titleInp = inp("kanban-col-title-input", col.title, "Column name…");
    titleInp.addEventListener("input", () => {
      const columns = attrs.columns.map(c =>
        c.id === col.id ? { ...c, title: titleInp.value } : c
      );
      this._patch({ columns });
    });

    const count = el("span", "kanban-col-count", String(issues.length));

    const deleteColBtn = btn("kanban-col-delete-btn", "✕", () => {
      if (!confirm(`Delete column "${col.title}" and its ${issues.length} issue(s)?`)) return;
      this._patch({
        columns: attrs.columns.filter(c => c.id !== col.id),
        issues:  attrs.issues.filter(i => i.columnId !== col.id),
      });
    });

    header.append(dot, titleInp, count, deleteColBtn);
    wrap.appendChild(header);

    // Drop zone
    const dropZone = el("div", "kanban-drop-zone");
    wrap.appendChild(dropZone);

    // Cards
    const cardList = el("div", "kanban-card-list");
    cardList.dataset.colId = col.id;
    issues.forEach(issue => cardList.appendChild(this._buildCard(issue)));
    wrap.appendChild(cardList);

    // Drag-over / drop on the whole column
    this._attachDropTarget(wrap, col.id, attrs);

    // Quick-add
    const quickAdd = this._buildQuickAdd(col, attrs);
    wrap.appendChild(quickAdd);

    return wrap;
  }

  // ── Card ──────────────────────────────────────────────────────

  _buildCard(issue) {
    const p = PRIORITY[issue.priority] || PRIORITY.none;
    const card = el("div", "kanban-card");
    card.draggable = true;
    card.dataset.issueId = issue.id;

    // Priority bar
    const bar = el("div", "kanban-card-bar");
    bar.style.background = p.color;
    card.appendChild(bar);

    // Content
    const content = el("div", "kanban-card-content");

    // Top row: priority icon + id + open button
    const top = el("div", "kanban-card-top");
    top.appendChild(el("span", "kanban-card-priority", p.icon));
    top.appendChild(el("span", "kanban-card-id", issue.id));
    top.appendChild(btn("kanban-card-open-btn", "↗", () => {
      this._detailId = this._detailId === issue.id ? null : issue.id;
      this._render(this.node.attrs);
    }));
    content.appendChild(top);

    // Title
    content.appendChild(el("p", "kanban-card-title", issue.title));

    // Bottom: assignee + labels
    const bottom = el("div", "kanban-card-bottom");
    if (issue.assignee) {
      const av = el("span", "kanban-card-avatar",
        issue.assignee.substring(0, 2).toUpperCase()
      );
      bottom.appendChild(av);
    }
    (issue.labels || []).forEach(lbl => {
      bottom.appendChild(el("span", "kanban-card-label", lbl));
    });
    content.appendChild(bottom);

    card.appendChild(content);

    // Drag events
    card.addEventListener("dragstart", e => {
      e.stopPropagation();
      this._draggingId = issue.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", issue.id);
    });
    card.addEventListener("dragend", e => {
      e.stopPropagation();
      this._draggingId = null;
      card.classList.remove("dragging");
      // clear all drop indicators
      this.dom.querySelectorAll(".kanban-column.drag-over")
        .forEach(c => c.classList.remove("drag-over"));
    });

    return card;
  }

  // ── Drag-drop target ──────────────────────────────────────────

  _attachDropTarget(colEl, colId, attrs) {
    colEl.addEventListener("dragover", e => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      this.dom.querySelectorAll(".kanban-column.drag-over")
        .forEach(c => c.classList.remove("drag-over"));
      colEl.classList.add("drag-over");
    });

    colEl.addEventListener("dragleave", e => {
      if (!colEl.contains(e.relatedTarget)) {
        colEl.classList.remove("drag-over");
      }
    });

    colEl.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      colEl.classList.remove("drag-over");
      const issueId = e.dataTransfer.getData("text/plain") || this._draggingId;
      if (!issueId) return;

      const issues = attrs.issues.map(i =>
        i.id === issueId ? { ...i, columnId: colId } : i
      );
      this._patch({ issues });
    });
  }

  // ── Quick-add form ────────────────────────────────────────────

  _buildQuickAdd(col, attrs) {
    const wrap = el("div", "kanban-quick-add");

    if (this._quickAddCol === col.id) {
      // Expanded form
      const titleInp = inp("kanban-qa-input", "", "Issue title…");
      titleInp.autofocus = true;
      setTimeout(() => titleInp.focus(), 50);

      const addBtn = btn("kanban-qa-submit", "Add", async () => {
        const title = titleInp.value.trim();
        if (!title) return;
        const docId = randomId();
        await docStore.create(docId, title);
        // Read this.node.attrs AFTER the await — attrs closure is stale
        const current = this.node.attrs;
        const newIssue = {
          id:          `ISS-${current.nextId}`,
          title,
          columnId:    col.id,
          priority:    "medium",
          assignee:    "",
          labels:      [],
          description: "",
          docId,
        };
        this._quickAddCol = null;
        this._patch({
          issues: [...current.issues, newIssue],
          nextId: current.nextId + 1,
        });
      });

      const cancelBtn = btn("kanban-qa-cancel", "✕", () => {
        this._quickAddCol = null;
        this._render(this.node.attrs);
      });

      titleInp.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter")  addBtn.click();
        if (e.key === "Escape") cancelBtn.click();
      });

      wrap.append(titleInp, addBtn, cancelBtn);
    } else {
      const openBtn = btn("kanban-qa-open-btn", "+ Add issue", () => {
        this._quickAddCol = col.id;
        this._render(this.node.attrs);
      });
      wrap.appendChild(openBtn);
    }

    return wrap;
  }

  // ── Issue editor (linked ProseMirror doc) ─────────────────────

  async _renderIssueEditor(issue, attrs) {
    // Destroy previous panel if any
    if (this._issuePanel?._destroy) this._issuePanel._destroy();

    // Migrate legacy issues that have no docId
    if (!issue.docId) {
      const docId = randomId();
      await docStore.create(docId, issue.title);
      issue = { ...issue, docId };
      // Use this.node.attrs.issues (current) — attrs closure may be stale
      this._patch({ issues: this.node.attrs.issues.map(i => i.id === issue.id ? issue : i) });
      // Let the re-render (triggered by _patch) open the panel with the updated issue
      return;
    }

    const close = () => {
      if (this._issuePanel?._destroy) this._issuePanel._destroy();
      this._issuePanel = null;
      this._detailId   = null;
      this._render(this.node.attrs);
    };

    const panel = await buildIssueEditor({
      issue,
      attrs,
      onClose: close,
      onPatch: patch => this._patch(patch),
    });

    this._issuePanel = panel;
    this.dom.appendChild(panel);
  }

  // ── ProseMirror integration ───────────────────────────────────

  // patch can be a plain object OR a function (currentAttrs) => partialPatch
  _patch(patch) {
    const { state, dispatch } = this.view;
    const current = this.node.attrs;
    const resolved = typeof patch === "function" ? patch(current) : patch;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, { ...current, ...resolved })
    );
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._render(node.attrs);
    return true;
  }

  destroy() {
    if (this._issuePanel?._destroy) this._issuePanel._destroy();
  }

  stopEvent(event) {
    // Let Escape bubble up so the editor can handle it globally
    if (event.type === "keydown" && event.key === "Escape") return false;
    return true;
  }

  ignoreMutation() { return true; }
}
