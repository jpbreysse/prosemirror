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
import { insertTodoBlock }         from "./extensions/todoBlock/commands.js";
import { insertAssetRef }          from "./extensions/assetRef/commands.js";
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
// Lucide SVG icons (15×15, stroke=currentColor)
// ------------------------------------------------------------------

function icon(paths) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICONS = {
  undo:        icon(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  redo:        icon(`<path d="m15 14 5-5-5-5"/><path d="M19 9H8.5a5.5 5.5 0 0 0 0 11H13"/>`),
  bold:        icon(`<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>`),
  italic:      icon(`<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>`),
  code:        icon(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`),
  link:        icon(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`),
  list:        icon(`<line x1="9" x2="20" y1="6" y2="6"/><line x1="9" x2="20" y1="12" y2="12"/><line x1="9" x2="20" y1="18" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>`),
  listOrdered: icon(`<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-2-2-2"/>`),
  quote:       icon(`<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>`),
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function button(label, title, run) {
  const btn = document.createElement("button");
  if (label.startsWith("<svg")) {
    btn.innerHTML = label;
  } else {
    btn.textContent = label;
  }
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
// Asset Reference picker
// ------------------------------------------------------------------

/**
 * Open a modal picker that searches the Asset Registry and inserts an
 * assetRef inline node at the current cursor position.
 */
function openAssetRefPicker(view) {
  // Remove any existing picker
  document.getElementById("asset-ref-picker")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "asset-ref-picker";
  overlay.className = "arp-overlay";

  const modal = document.createElement("div");
  modal.className = "arp-modal";

  // ── Header ────────────────────────────────────────────────────
  const hdr = document.createElement("div");
  hdr.className = "arp-header";
  hdr.innerHTML = `<span class="arp-title">⚙ Insert Asset Reference</span>`;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "arp-close"; closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => overlay.remove());
  hdr.appendChild(closeBtn);

  // ── Search input ──────────────────────────────────────────────
  const searchWrap = document.createElement("div");
  searchWrap.className = "arp-search-wrap";
  const searchInp = document.createElement("input");
  searchInp.type = "text"; searchInp.className = "arp-search"; searchInp.placeholder = "Search by tag or name…";
  searchWrap.appendChild(searchInp);

  // ── Results list ──────────────────────────────────────────────
  const results = document.createElement("div");
  results.className = "arp-results";
  results.innerHTML = `<div class="arp-hint">Start typing to search assets…</div>`;

  let debounce = null;
  let lastQuery = "";

  async function doSearch(q) {
    if (q === lastQuery) return;
    lastQuery = q;
    if (!q.trim()) {
      results.innerHTML = `<div class="arp-hint">Start typing to search assets…</div>`;
      return;
    }
    results.innerHTML = `<div class="arp-hint">Searching…</div>`;
    try {
      const res  = await fetch(`/api/connect/asset-registry/assets?search=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json();
      if (!data.length) {
        results.innerHTML = `<div class="arp-hint">No assets found for "${q}"</div>`;
        return;
      }
      results.innerHTML = "";
      data.forEach(asset => {
        const row = document.createElement("div");
        row.className = "arp-row";

        const tag = document.createElement("span");
        tag.className = "arp-row-tag"; tag.textContent = asset.tag || "—";

        const name = document.createElement("span");
        name.className = "arp-row-name"; name.textContent = asset.name || "";

        const cls = document.createElement("span");
        cls.className = "arp-row-cls"; cls.textContent = asset.classCode || "";

        row.append(tag, name, cls);
        row.addEventListener("mousedown", e => {
          e.preventDefault();
          const display = asset.tag && asset.name
            ? `${asset.tag} (${asset.name})`
            : (asset.tag || asset.name || asset.id);
          view.dispatch(
            view.state.tr.replaceSelectionWith(
              view.state.schema.nodes.assetRef.create({
                assetId: asset.id,
                tag:     asset.tag     || "",
                display,
              })
            ).scrollIntoView()
          );
          overlay.remove();
          view.focus();
        });
        results.appendChild(row);
      });
    } catch (err) {
      results.innerHTML = `<div class="arp-hint arp-error">Search failed: ${err.message}</div>`;
    }
  }

  searchInp.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(searchInp.value.trim()), 300);
  });
  searchInp.addEventListener("keydown", e => {
    if (e.key === "Escape") overlay.remove();
  });

  // Close on overlay click (outside modal)
  overlay.addEventListener("mousedown", e => {
    if (e.target === overlay) overlay.remove();
  });

  modal.append(hdr, searchWrap, results);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  setTimeout(() => searchInp.focus(), 0);
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
      linkBtn.innerHTML   = ICONS.link;
      linkBtn.title       = "Link (Cmd+K)";
      linkBtn.type        = "button";
      linkBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation(); // prevent the event bubbling to the document "outside click" listener
        if (popupOpen) { closePopup(); return; }
        openPopup(linkBtn);
      });

      // ── Stored refs for mark-active tracking ──────────────────
      const boldBtn   = button(ICONS.bold,   "Bold (Ctrl+B)",        () => run(toggleMark(marks.strong)));
      const italicBtn = button(ICONS.italic, "Italic (Ctrl+I)",      () => run(toggleMark(marks.em)));
      const codeBtn   = button(ICONS.code,   "Inline Code (Ctrl+`)", () => run(toggleMark(marks.code)));

      // ── Extension catalogue (all insertable blocks) ───────────────
      const EXT_ITEMS = [
        { key: "graph",           icon: "📊", label: "Chart",              cmd: () => run(insertGraph()) },
        { key: "map",             icon: "🗺️", label: "Map",                cmd: () => run(insertMap()) },
        { key: "diagram",         icon: "🔷", label: "Diagram",            cmd: () => run(insertDiagram()) },
        { key: "product",         icon: "🛍️", label: "Product",            cmd: () => run(insertProduct()) },
        { key: "table",           icon: "⊞",  label: "Table",              cmd: () => run(insertTable(3, 3)) },
        { key: "fhir",            icon: "🏥", label: "FHIR Resource",      cmd: () => run(insertFhir()) },
        { key: "form",            icon: "📋", label: "Form",               cmd: () => run(insertForm()) },
        { key: "kanban",          icon: "🗂️", label: "Kanban",             cmd: () => run(insertKanban()) },
        { key: "assetGraph",      icon: "🏭", label: "Asset Graph",        cmd: () => run(insertAssetGraph()) },
        { key: "carGraph",        icon: "🚗", label: "Drivetrain",         cmd: () => run(insertCarGraph()) },
        { key: "meetingNotes",    icon: "📅", label: "Meeting Notes",      cmd: () => run(insertMeetingNotes()) },
        { key: "markdownBlock",   icon: "𝐌↓", label: "Markdown",           cmd: () => run(insertMarkdownBlock()) },
        { key: "graphBuilder",    icon: "🔷", label: "Graph Builder",      cmd: () => run(insertGraphBuilder()) },
        { key: "imageBlock",      icon: "🖼",  label: "Image",              cmd: () => run(insertImageBlock()) },
        { key: "moleculeBlock",   icon: "⚗️", label: "Molecule",           cmd: () => run(insertMoleculeBlock()) },
        { key: "riskMatrix",      icon: "🎯", label: "Risk Matrix",        cmd: () => run(insertRiskMatrix()) },
        { key: "customerBlock",   icon: "👤", label: "Customer",           cmd: () => run(insertCustomerBlock()) },
        { key: "clauseBlock",     icon: "📋", label: "Clause",             cmd: () => run(insertClauseBlock()) },
        { key: "partyBlock",      icon: "🏢", label: "Party",              cmd: () => run(insertPartyBlock()) },
        { key: "matterBlock",     icon: "📁", label: "Matter",             cmd: () => run(insertMatterBlock()) },
        { key: "versionTimeline", icon: "🕓", label: "Version Timeline",   cmd: () => run(insertVersionTimeline()) },
        { key: "bomBlock",        icon: "⚙️", label: "Bill of Materials",  cmd: () => run(insertBomBlock()) },
        { key: "maintenanceBlock",icon: "🔧", label: "Maintenance",        cmd: () => run(insertMaintenanceBlock()) },
        { key: "todoBlock",       icon: "✅", label: "Daily Todo",         cmd: () => run(insertTodoBlock()) },
        { key: "mermaidBlock",    icon: "🔀", label: "Mermaid Diagram",    cmd: () => run(insertMermaidBlock()) },
        { key: "assetRef",        icon: "⚙",  label: "Asset Reference",   cmd: () => openAssetRefPicker(editorView) },
        { key: "reply",           icon: "💬", label: "Reply",              cmd: () => run(insertReply()) },
      ].filter(e => isOn(e.key));

      // ── Insert dropdown ────────────────────────────────────────
      let insertOpen = false;

      const insertWrap  = document.createElement("div");
      insertWrap.className = "insert-wrap";

      const insertBtn   = document.createElement("button");
      insertBtn.type    = "button";
      insertBtn.className = "insert-trigger";
      insertBtn.title   = "Insert block";
      insertBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Insert`;

      const insertPanel = document.createElement("div");
      insertPanel.className = "insert-panel";

      EXT_ITEMS.forEach(ext => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "insert-item";
        item.innerHTML = `<span class="insert-item-icon">${ext.icon}</span><span class="insert-item-label">${ext.label}</span>`;
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          ext.cmd();
          closeInsert();
          editorView.focus();
        });
        insertPanel.appendChild(item);
      });

      function closeInsert() {
        insertPanel.hidden = true;
        insertOpen = false;
      }

      insertBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        if (insertOpen) { closeInsert(); return; }
        insertPanel.hidden = false;
        insertOpen = true;
      });

      document.addEventListener("mousedown", e => {
        if (insertOpen && !insertWrap.contains(e.target)) closeInsert();
      });

      insertPanel.hidden = true;
      insertWrap.append(insertBtn, insertPanel);

      // ── Toolbar items ──────────────────────────────────────────
      const items = [
        button(ICONS.undo,        "Undo (Ctrl+Z)",   () => run(undo)),
        button(ICONS.redo,        "Redo (Ctrl+Y)",   () => run(redo)),
        separator(),
        boldBtn,
        italicBtn,
        codeBtn,
        linkBtn,
        separator(),
        button("¶",               "Paragraph",      () => run(setBlockType(nodes.paragraph))),
        button("H1",              "Heading 1",      () => run(setBlockType(nodes.heading, { level: 1 }))),
        button("H2",              "Heading 2",      () => run(setBlockType(nodes.heading, { level: 2 }))),
        button("H3",              "Heading 3",      () => run(setBlockType(nodes.heading, { level: 3 }))),
        separator(),
        button(ICONS.list,        "Bullet List",    () => run(wrapInList(nodes.bullet_list))),
        button(ICONS.listOrdered, "Ordered List",   () => run(wrapInList(nodes.ordered_list))),
        separator(),
        button(ICONS.quote,       "Blockquote",     () => run(wrapIn(nodes.blockquote))),
        ...(EXT_ITEMS.length ? [separator(), insertWrap] : []),
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
