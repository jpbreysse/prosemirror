/**
 * extensions/kanban/issueEditor.js
 *
 * Builds a fully independent ProseMirror EditorView for an issue document.
 * This editor lives inside the KanbanNodeView DOM — it is a separate
 * EditorView instance, completely decoupled from the outer board editor.
 *
 * Features:
 *   • Full rich-text editing (headings, bold, italic, lists, code)
 *   • Auto-saves to docStore on every transaction (debounced 400ms)
 *   • "Saved ✓" / "Saving…" indicator
 *   • Minimal toolbar (B, I, H1, H2, • List)
 *   • Keyboard shortcuts inherited from the main keymap
 */

import { EditorState } from "prosemirror-state";
import { EditorView }  from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap }      from "prosemirror-keymap";
import {
  baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands,
} from "prosemirror-commands";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { inputRules, wrappingInputRule, textblockTypeInputRule } from "prosemirror-inputrules";
import { schema }      from "../../schema.js";
import { docStore }    from "../../store/docStore.js";

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.flat(Infinity).filter(Boolean).forEach(c =>
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  );
  return e;
}

function toolBtn(label, title, onClick) {
  const b = document.createElement("button");
  b.className   = "issue-editor-tool-btn";
  b.textContent = label;
  b.title       = title;
  b.type        = "button";
  b.addEventListener("mousedown", e => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

// ── Input rules (same as main editor) ────────────────────────────────────────

function buildInputRules() {
  const { nodes } = schema;
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, m => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^\s*([-*])\s$/, nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list),
    ],
  });
}

// ── Keymap ────────────────────────────────────────────────────────────────────

function buildKeymap() {
  const { marks, nodes } = schema;
  return keymap({
    "Mod-z":        undo,
    "Mod-y":        redo,
    "Shift-Mod-z":  redo,
    "Mod-b":        toggleMark(marks.strong),
    "Mod-i":        toggleMark(marks.em),
    "Mod-`":        toggleMark(marks.code),
    "Shift-Ctrl-1": setBlockType(nodes.heading,   { level: 1 }),
    "Shift-Ctrl-2": setBlockType(nodes.heading,   { level: 2 }),
    "Shift-Ctrl-0": setBlockType(nodes.paragraph),
    "Enter":        chainCommands(splitListItem(nodes.list_item), baseKeymap["Enter"]),
    "Tab":          sinkListItem(nodes.list_item),
    "Shift-Tab":    liftListItem(nodes.list_item),
    ...baseKeymap,
  });
}

// ── IssueEditor factory ───────────────────────────────────────────────────────

/**
 * Creates the full panel DOM for an issue document editor.
 *
 * @param {object}   issue      — the kanban issue object
 * @param {object}   attrs      — current kanban board attrs
 * @param {function} onClose    — called when the panel is closed
 * @param {function} onPatch    — called with partial attrs to update the board
 * @returns {HTMLElement}       — the panel DOM element
 */
export async function buildIssueEditor({ issue, attrs, onClose, onPatch }) {
  // ── Ensure the document exists in the store ───────────────────
  if (!await docStore.exists(issue.docId)) {
    await docStore.create(issue.docId, issue.title);
  }

  const savedJSON = await docStore.load(issue.docId);

  // ── Parse the saved document ──────────────────────────────────
  let doc;
  try {
    doc = schema.nodeFromJSON(savedJSON);
  } catch {
    // Fallback if stored JSON is incompatible with current schema
    doc = schema.node("doc", null, [
      schema.node("heading",   { level: 1 }, [schema.text(issue.title)]),
      schema.node("paragraph", null, []),
    ]);
  }

  // ── Panel DOM ──────────────────────────────────────────────────
  const panel = el("div", "issue-editor-panel");
  panel.addEventListener("mousedown", e => e.stopPropagation());
  panel.addEventListener("click",     e => e.stopPropagation());
  panel.addEventListener("keydown",   e => e.stopPropagation());

  // ── Panel header ───────────────────────────────────────────────
  const header = el("div", "issue-editor-header");

  const backBtn = document.createElement("button");
  backBtn.className   = "issue-editor-back-btn";
  backBtn.textContent = "← Board";
  backBtn.type        = "button";
  backBtn.addEventListener("mousedown", e => e.preventDefault());
  backBtn.addEventListener("click",     e => { e.stopPropagation(); onClose(); });

  const issueIdEl = el("span", "issue-editor-id", issue.id);

  const saveIndicator = el("span", "issue-editor-save-indicator", "");

  const closeBtn = document.createElement("button");
  closeBtn.className   = "issue-editor-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.type        = "button";
  closeBtn.addEventListener("mousedown", e => e.preventDefault());
  closeBtn.addEventListener("click",     e => { e.stopPropagation(); onClose(); });

  header.append(backBtn, issueIdEl, saveIndicator, closeBtn);
  panel.appendChild(header);

  // ── Metadata strip ─────────────────────────────────────────────
  const meta = el("div", "issue-editor-meta");

  // Column selector
  const colSel = document.createElement("select");
  colSel.className = "issue-editor-meta-select";
  attrs.columns.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.title;
    if (c.id === issue.columnId) o.selected = true;
    colSel.appendChild(o);
  });
  colSel.addEventListener("change", e => {
    e.stopPropagation();
    onPatch(cur => ({ issues: cur.issues.map(i =>
      i.id === issue.id ? { ...i, columnId: colSel.value } : i
    )}));
  });
  ["mousedown","click","keydown"].forEach(ev =>
    colSel.addEventListener(ev, e => e.stopPropagation())
  );

  // Priority selector
  const PRIORITY_OPTS = [
    { v: "urgent", l: "🔴 Urgent" },
    { v: "high",   l: "🟠 High"   },
    { v: "medium", l: "🟡 Medium" },
    { v: "low",    l: "🔵 Low"    },
    { v: "none",   l: "⚪ None"   },
  ];
  const priSel = document.createElement("select");
  priSel.className = "issue-editor-meta-select";
  PRIORITY_OPTS.forEach(({ v, l }) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = l;
    if (v === issue.priority) o.selected = true;
    priSel.appendChild(o);
  });
  priSel.addEventListener("change", e => {
    e.stopPropagation();
    onPatch(cur => ({ issues: cur.issues.map(i =>
      i.id === issue.id ? { ...i, priority: priSel.value } : i
    )}));
  });
  ["mousedown","click","keydown"].forEach(ev =>
    priSel.addEventListener(ev, e => e.stopPropagation())
  );

  // Assignee input
  const assigneeInp = document.createElement("input");
  assigneeInp.className   = "issue-editor-meta-input";
  assigneeInp.type        = "text";
  assigneeInp.value       = issue.assignee || "";
  assigneeInp.placeholder = "Assignee…";
  ["mousedown","click","keydown"].forEach(ev =>
    assigneeInp.addEventListener(ev, e => e.stopPropagation())
  );
  assigneeInp.addEventListener("change", () => {
    onPatch(cur => ({ issues: cur.issues.map(i =>
      i.id === issue.id ? { ...i, assignee: assigneeInp.value.trim() } : i
    )}));
  });

  meta.append(colSel, priSel, assigneeInp);
  panel.appendChild(meta);

  // ── Toolbar ────────────────────────────────────────────────────
  const toolbar = el("div", "issue-editor-toolbar");

  const run = cmd => cmd(editorView.state, editorView.dispatch, editorView);

  const toolButtons = [
    toolBtn("B",  "Bold (Cmd+B)",          () => run(toggleMark(schema.marks.strong))),
    toolBtn("I",  "Italic (Cmd+I)",        () => run(toggleMark(schema.marks.em))),
    toolBtn("</>","Code (Cmd+`)",           () => run(toggleMark(schema.marks.code))),
    toolBtn("H1", "Heading 1",             () => run(setBlockType(schema.nodes.heading, { level: 1 }))),
    toolBtn("H2", "Heading 2",             () => run(setBlockType(schema.nodes.heading, { level: 2 }))),
    toolBtn("¶",  "Paragraph",             () => run(setBlockType(schema.nodes.paragraph))),
    toolBtn("•",  "Bullet list",           () => run(wrapIn(schema.nodes.bullet_list))),
    toolBtn("1.", "Ordered list",          () => run(wrapIn(schema.nodes.ordered_list))),
    toolBtn("❝",  "Blockquote",            () => run(wrapIn(schema.nodes.blockquote))),
    toolBtn("↩",  "Undo (Cmd+Z)",         () => run(undo)),
    toolBtn("↪",  "Redo (Cmd+Shift+Z)",   () => run(redo)),
  ];
  toolButtons.forEach(b => toolbar.appendChild(b));
  panel.appendChild(toolbar);

  // ── Editor mount point ─────────────────────────────────────────
  const editorMount = el("div", "issue-editor-body");
  // Set white-space before EditorView construction so getComputedStyle check passes
  editorMount.style.whiteSpace = "pre-wrap";
  panel.appendChild(editorMount);

  // ── Auto-save logic ────────────────────────────────────────────
  let saveTimer = null;
  function scheduleSave(view) {
    saveIndicator.textContent = "Saving…";
    saveIndicator.className   = "issue-editor-save-indicator saving";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const title = (() => {
        let t = issue.title;
        view.state.doc.descendants(node => {
          if (node.type.name === "heading" && node.attrs.level === 1) {
            t = node.textContent;
            return false;
          }
        });
        return t;
      })();
      docStore.save(issue.docId, view.state.doc.toJSON(), title);
      saveIndicator.textContent = "Saved ✓";
      saveIndicator.className   = "issue-editor-save-indicator saved";
      setTimeout(() => { saveIndicator.textContent = ""; }, 2000);
    }, 400);
  }

  // ── EditorView ─────────────────────────────────────────────────
  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      buildKeymap(),
      buildInputRules(),
    ],
  });

  const editorView = new EditorView(editorMount, {
    state,
    dispatchTransaction(tr) {
      const next = editorView.state.apply(tr);
      editorView.updateState(next);
      if (tr.docChanged) scheduleSave(editorView);
    },
  });

  // Focus the editor after a tick
  setTimeout(() => editorView.focus(), 80);

  // ── Cleanup on close ───────────────────────────────────────────
  panel._destroy = () => {
    clearTimeout(saveTimer);
    // Final save before closing
    docStore.save(issue.docId, editorView.state.doc.toJSON(), issue.title);
    editorView.destroy();
  };

  return panel;
}
