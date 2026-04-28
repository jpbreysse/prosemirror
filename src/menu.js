/**
 * menu.js
 *
 * A lightweight DOM toolbar wired up to ProseMirror commands.
 * Returns a Plugin that mounts the toolbar into #toolbar on init
 * and keeps button states in sync with the editor selection.
 */

import { Plugin } from "prosemirror-state";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { undo, redo } from "prosemirror-history";
import { schema } from "./schema.js";
import { insertGraph } from "./extensions/graph/commands.js";
import { insertMap }      from "./extensions/map/commands.js";
import { insertDiagram }  from "./extensions/diagram/commands.js";
import { insertProduct }  from "./extensions/product/commands.js";
import { insertFhir }     from "./extensions/fhir/commands.js";
import { insertForm }     from "./extensions/form/commands.js";
import { insertKanban }   from "./extensions/kanban/commands.js";
import { insertReply, getCurrentUser, setCurrentUser, authorColor } from "./extensions/reply/commands.js";
import { insertAssetGraph } from "./extensions/assetGraph/commands.js";
import { insertCarGraph }     from "./extensions/carGraph/commands.js";
import { insertMeetingNotes }   from "./extensions/meetingNotes/commands.js";
import { insertMarkdownBlock }  from "./extensions/markdownBlock/commands.js";
import { insertGraphBuilder }   from "./extensions/graphBuilder/commands.js";
import { insertImageBlock }     from "./extensions/imageBlock/commands.js";
import { insertMoleculeBlock }  from "./extensions/moleculeBlock/commands.js";
import { insertRiskMatrix }     from "./extensions/riskMatrix/commands.js";
import { insertCustomerBlock }  from "./extensions/customerBlock/commands.js";
import { insertClauseBlock }    from "./extensions/clauseBlock/commands.js";
import { insertPartyBlock }     from "./extensions/partyBlock/commands.js";
import { insertMatterBlock }      from "./extensions/matterBlock/commands.js";
import { insertVersionTimeline }  from "./extensions/versionTimeline/commands.js";
import { insertMermaidBlock }      from "./extensions/mermaidBlock/commands.js";
import { insertBomBlock }          from "./extensions/bomBlock/commands.js";
import { insertMaintenanceBlock }  from "./extensions/maintenanceBlock/commands.js";
import {
  insertTable,
  addRowAfter, addRowBefore, deleteRow,
  addColumnAfter, addColumnBefore, deleteColumn,
  deleteTable, toggleHeaderRow,
} from "./extensions/table/commands.js";

// ------------------------------------------------------------------
// Link helpers
// ------------------------------------------------------------------

// Returns the link Mark at the current cursor / selection, or null.
function getActiveLinkMark(state) {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return $from.marks().find(m => m.type === schema.marks.link) ?? null;
  }
  let found = null;
  state.doc.nodesBetween(from, to, node => {
    if (node.isText) {
      const m = node.marks.find(m => m.type === schema.marks.link);
      if (m) found = m;
    }
  });
  return found;
}

// Apply (or update) a link mark over the current selection.
function applyLink(href, state, dispatch) {
  const { from, to } = state.selection;
  if (from === to) return false;
  if (dispatch) {
    const tr = state.tr
      .removeMark(from, to, schema.marks.link)
      .addMark(from, to, schema.marks.link.create({ href }));
    dispatch(tr);
  }
  return true;
}

// Remove all link marks from the current selection.
function removeLink(state, dispatch) {
  const { from, to } = state.selection;
  if (dispatch) dispatch(state.tr.removeMark(from, to, schema.marks.link));
  return true;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function button(label, title, run) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.title = title;
  btn.type = "button";
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // keep editor focus
    run();
  });
  return btn;
}

function separator() {
  const s = document.createElement("span");
  s.className = "menu-sep";
  return s;
}

// ------------------------------------------------------------------
// Plugin
// ------------------------------------------------------------------

/**
 * @param {string} containerSelector
 * @param {Record<string,boolean>|null} extConfig  null = all enabled;
 *   object = only keys with value !== false are shown (missing keys default to enabled)
 */
export function menuPlugin(containerSelector = "#toolbar", extConfig = null) {
  return new Plugin({
    view(editorView) {
      const container = document.querySelector(containerSelector);
      if (!container) return {};

      const { marks, nodes } = schema;
      const run  = (cmd) => cmd(editorView.state, editorView.dispatch, editorView);
      const isOn = (key) => extConfig === null || extConfig[key] !== false;

      // ── Link popup ─────────────────────────────────────────────
      // A small floating panel anchored below the link button.
      const popup     = document.createElement("div");
      popup.className = "link-popup";
      popup.style.display = "none";

      const urlInput  = document.createElement("input");
      urlInput.type        = "url";
      urlInput.placeholder = "https://…";
      urlInput.className   = "link-popup-input";

      const applyBtn  = document.createElement("button");
      applyBtn.type        = "button";
      applyBtn.textContent = "Apply";
      applyBtn.className   = "link-popup-btn link-popup-btn--apply";

      const removeBtn = document.createElement("button");
      removeBtn.type        = "button";
      removeBtn.textContent = "Remove";
      removeBtn.className   = "link-popup-btn link-popup-btn--remove";

      popup.addEventListener("mousedown", e => e.stopPropagation());
      popup.append(urlInput, applyBtn, removeBtn);
      // Mount next to the toolbar (not inside it) to avoid z-index issues
      container.parentElement.style.position = "relative";
      container.parentElement.appendChild(popup);

      let popupOpen = false;

      function openPopup(linkBtn) {
        const existing = getActiveLinkMark(editorView.state);
        urlInput.value      = existing ? existing.attrs.href : "";
        removeBtn.style.display = existing ? "inline-block" : "none";

        // Position below the link button
        const btnRect  = linkBtn.getBoundingClientRect();
        const wrapRect = container.parentElement.getBoundingClientRect();
        popup.style.top  = (btnRect.bottom - wrapRect.top + 4) + "px";
        popup.style.left = (btnRect.left   - wrapRect.left)    + "px";
        popup.style.display = "flex";
        popupOpen = true;
        urlInput.focus();
      }

      function closePopup() {
        popup.style.display = "none";
        popupOpen = false;
        editorView.focus();
      }

      applyBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        const href = urlInput.value.trim();
        if (href) applyLink(href, editorView.state, editorView.dispatch);
        closePopup();
      });

      removeBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        removeLink(editorView.state, editorView.dispatch);
        closePopup();
      });

      urlInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          const href = urlInput.value.trim();
          if (href) applyLink(href, editorView.state, editorView.dispatch);
          closePopup();
        }
        if (e.key === "Escape") closePopup();
      });

      // Close popup on outside click
      document.addEventListener("mousedown", e => {
        if (popupOpen && !popup.contains(e.target)) closePopup();
      });

      // ── Link button ────────────────────────────────────────────
      const linkBtn = document.createElement("button");
      linkBtn.textContent = "🔗";
      linkBtn.title       = "Link (Cmd+K)";
      linkBtn.type        = "button";
      linkBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation(); // prevent the event bubbling to the document "outside click" listener
        if (popupOpen) { closePopup(); return; }
        openPopup(linkBtn);
      });

      // ── Stored refs for mark-active tracking ──────────────────
      const boldBtn   = button("B",   "Bold (Ctrl+B)",        () => run(toggleMark(marks.strong)));
      const italicBtn = button("I",   "Italic (Ctrl+I)",      () => run(toggleMark(marks.em)));
      const codeBtn   = button("</>", "Inline Code (Ctrl+`)", () => run(toggleMark(marks.code)));

      // ── Extension buttons (conditionally shown) ────────────────
      const extGroup1 = [
        isOn("graph")    && button("📊",  "Insert Chart",         () => run(insertGraph())),
        isOn("map")      && button("🗺️", "Insert Map",            () => run(insertMap())),
        isOn("diagram")  && button("🔷",  "Insert Diagram",       () => run(insertDiagram())),
        isOn("product")  && button("🛍️", "Insert Product",        () => run(insertProduct())),
        isOn("table")    && button("⊞",   "Insert Table",         () => run(insertTable(3, 3))),
        isOn("fhir")     && button("🏥",  "Insert FHIR Resource", () => run(insertFhir())),
        isOn("form")     && button("📋",  "Insert Form",          () => run(insertForm())),
        isOn("kanban")   && button("🗂️", "Insert Kanban Board",   () => run(insertKanban())),
      ].filter(Boolean);

      const extGroup2 = [
        isOn("assetGraph")       && button("🏭",  "Insert Asset Graph",          () => run(insertAssetGraph())),
        isOn("carGraph")         && button("🚗",  "Insert Car Drivetrain",       () => run(insertCarGraph())),
        isOn("meetingNotes")     && button("📅",  "Insert Meeting Notes",        () => run(insertMeetingNotes())),
        isOn("markdownBlock")    && button("𝐌↓",  "Insert Markdown Block",       () => run(insertMarkdownBlock())),
        isOn("graphBuilder")     && button("🔷",  "Insert Graph Builder",        () => run(insertGraphBuilder())),
        isOn("imageBlock")       && button("🖼",   "Insert Image",               () => run(insertImageBlock())),
        isOn("moleculeBlock")    && button("⚗️",  "Insert Molecule",             () => run(insertMoleculeBlock())),
        isOn("riskMatrix")       && button("🎯",  "Insert Risk Matrix",          () => run(insertRiskMatrix())),
        isOn("customerBlock")    && button("👤",  "Insert Customer Card",        () => run(insertCustomerBlock())),
        isOn("clauseBlock")      && button("📋",  "Insert Clause Block",         () => run(insertClauseBlock())),
        isOn("partyBlock")       && button("🏢",  "Insert Party Block",          () => run(insertPartyBlock())),
        isOn("matterBlock")      && button("📁",  "Insert Matter Block",         () => run(insertMatterBlock())),
        isOn("versionTimeline")  && button("🕓",  "Insert Version Timeline",     () => run(insertVersionTimeline())),
        isOn("bomBlock")         && button("⚙️",  "Insert Bill of Materials",    () => run(insertBomBlock())),
        isOn("maintenanceBlock") && button("🔧",  "Insert Maintenance Schedule", () => run(insertMaintenanceBlock())),
        isOn("mermaidBlock")     && button("🔀",  "Insert Mermaid Diagram",      () => run(insertMermaidBlock())),
        isOn("reply")            && button("💬",  "Add Reply",                   () => run(insertReply())),
      ].filter(Boolean);

      // ── Toolbar items ──────────────────────────────────────────
      const items = [
        button("↩",      "Undo (Ctrl+Z)",   () => run(undo)),
        button("↪",      "Redo (Ctrl+Y)",   () => run(redo)),
        separator(),
        boldBtn,
        italicBtn,
        codeBtn,
        linkBtn,
        separator(),
        button("¶",       "Paragraph",      () => run(setBlockType(nodes.paragraph))),
        button("H1",      "Heading 1",      () => run(setBlockType(nodes.heading, { level: 1 }))),
        button("H2",      "Heading 2",      () => run(setBlockType(nodes.heading, { level: 2 }))),
        button("H3",      "Heading 3",      () => run(setBlockType(nodes.heading, { level: 3 }))),
        separator(),
        button("• List",  "Bullet List",    () => run(wrapInList(nodes.bullet_list))),
        button("1. List", "Ordered List",   () => run(wrapInList(nodes.ordered_list))),
        separator(),
        button("❝",       "Blockquote",     () => run(wrapIn(nodes.blockquote))),
        ...(extGroup1.length                    ? [separator(), ...extGroup1]  : []),
        ...(extGroup1.length && extGroup2.length ? [separator()]               : []),
        ...extGroup2,
        (() => {
          // User identity pill — shows current user, click to change
          const pill = document.createElement("div");
          pill.className = "user-identity-pill";
          const dot  = document.createElement("span");
          dot.className  = "user-identity-dot";
          const name = document.createElement("span");
          name.className = "user-identity-name";

          function refresh() {
            const user  = getCurrentUser();
            const color = authorColor(user);
            dot.style.background = color;
            name.textContent     = user;
            pill.title           = "Click to change identity";
          }
          refresh();
          pill.append(dot, name);
          pill.addEventListener("mousedown", e => e.preventDefault());
          pill.addEventListener("click", () => {
            const current = getCurrentUser();
            const input   = prompt("Your name:", current);
            if (input && input.trim()) {
              setCurrentUser(input.trim());
              refresh();
            }
          });
          return pill;
        })(),
      ];

      items.forEach(item => container.appendChild(item));

      // ── Contextual table toolbar ───────────────────────────────
      // Shown only when the cursor is inside a table.
      const tableBar = document.createElement("div");
      tableBar.className    = "table-toolbar";
      tableBar.style.display = "none";

      const tBtn = (label, title, cmd) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.title       = title;
        b.type        = "button";
        b.addEventListener("mousedown", e => {
          e.preventDefault();
          cmd(editorView.state, editorView.dispatch);
        });
        return b;
      };

      tableBar.append(
        tBtn("+ Row ↓",  "Add row below",       addRowAfter),
        tBtn("+ Row ↑",  "Add row above",        addRowBefore),
        tBtn("− Row",    "Delete row",           deleteRow),
        document.createElement("span"),  // separator
        tBtn("+ Col →",  "Add column after",     addColumnAfter),
        tBtn("+ Col ←",  "Add column before",    addColumnBefore),
        tBtn("− Col",    "Delete column",        deleteColumn),
        document.createElement("span"),  // separator
        tBtn("H Row",    "Toggle header row",    toggleHeaderRow),
        tBtn("✕ Table",  "Delete table",         deleteTable),
      );

      // Style the separators
      tableBar.querySelectorAll("span").forEach(s => s.className = "menu-sep");
      // Append inside the toolbar wrapper so it sits as a second row
      container.parentElement.insertBefore(tableBar, container.nextSibling);

      // Helper: is cursor inside a table?
      function isInTable(state) {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.spec.tableRole === "row") return true;
        }
        return false;
      }

      // ── Update (active states) ─────────────────────────────────
      return {
        update(view) {
          const { from, $from, to, empty } = view.state.selection;

          // Use stored button refs (safe regardless of which ext buttons are visible)
          [
            { btn: boldBtn,   mark: marks.strong },
            { btn: italicBtn, mark: marks.em },
            { btn: codeBtn,   mark: marks.code },
          ].forEach(({ btn, mark }) => {
            const active = empty
              ? mark.isInSet(view.state.storedMarks || $from.marks())
              : view.state.doc.rangeHasMark(from, to, mark);
            btn.classList.toggle("active", !!active);
          });

          // Link button: active when cursor is inside a link
          linkBtn.classList.toggle("active", !!getActiveLinkMark(view.state));

          // Show/hide contextual table toolbar
          tableBar.style.display = isInTable(view.state) ? "flex" : "none";
        },
        destroy() {
          popup.remove();
          tableBar.remove();
          container.innerHTML = "";
        },
      };
    },
  });
}
