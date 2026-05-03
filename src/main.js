/**
 * main.js
 *
 * Editor bootstrap — wires together schema, plugins, and the view.
 *
 * URL params:
 *   ?id=<uuid>  → loads the document from PostgreSQL and auto-saves on change
 *   (none)      → opens a default scratch document (not persisted)
 */

import "./editor.css";
import { mountEditorSidebar } from "./editorSidebar.js";

import { extractLines, diffLines, diffStats } from "./utils/diff.js";
import { EditorState, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { history } from "prosemirror-history";
import { inputRules, wrappingInputRule, textblockTypeInputRule } from "prosemirror-inputrules";
import { tableEditing, columnResizing, goToNextCell } from "prosemirror-tables";
import { tableHoverPlugin } from "./extensions/table/hoverPlugin.js";
import { keymap } from "prosemirror-keymap";

import { schema } from "./schema.js";
import { editorKeymap } from "./keymap.js";
import { menuPlugin } from "./menu.js";
import { dragHandlePlugin } from "./plugins/dragHandle.js";
import { GraphNodeView }     from "./extensions/graph/nodeView.js";
import { MapNodeView }       from "./extensions/map/nodeView.js";
import { DiagramNodeView }   from "./extensions/diagram/nodeView.js";
import { ProductNodeView }   from "./extensions/product/nodeView.js";
import { FhirNodeView }      from "./extensions/fhir/nodeView.js";
import { FormNodeView }      from "./extensions/form/nodeView.js";
import { KanbanNodeView }    from "./extensions/kanban/nodeView.js";
import { ReplyNodeView }     from "./extensions/reply/nodeView.js";
import { AssetGraphNodeView } from "./extensions/assetGraph/nodeView.js";
import { CarGraphNodeView }   from "./extensions/carGraph/nodeView.js";
import { SubGraphNodeView }     from "./extensions/subGraph/nodeView.js";
import { MeetingNotesNodeView }  from "./extensions/meetingNotes/nodeView.js";
import { MarkdownBlockNodeView } from "./extensions/markdownBlock/nodeView.js";
import { GraphBuilderNodeView }  from "./extensions/graphBuilder/nodeView.js";
import { ImageBlockNodeView }    from "./extensions/imageBlock/nodeView.js";
import { MoleculeBlockNodeView } from "./extensions/moleculeBlock/nodeView.js";
import { RiskMatrixNodeView }    from "./extensions/riskMatrix/nodeView.js";
import { CustomerBlockNodeView } from "./extensions/customerBlock/nodeView.js";
import { ClauseBlockNodeView }   from "./extensions/clauseBlock/nodeView.js";
import { PartyBlockNodeView }    from "./extensions/partyBlock/nodeView.js";
import { MatterBlockNodeView }        from "./extensions/matterBlock/nodeView.js";
import { VersionTimelineNodeView }    from "./extensions/versionTimeline/nodeView.js";
import { MermaidBlockNodeView }       from "./extensions/mermaidBlock/nodeView.js";
import { BomBlockNodeView }           from "./extensions/bomBlock/nodeView.js";
import { MaintenanceBlockNodeView }   from "./extensions/maintenanceBlock/nodeView.js";
import { TodoBlockNodeView }          from "./extensions/todoBlock/nodeView.js";
import { AssetRefNodeView }           from "./extensions/assetRef/nodeView.js";

// ── URL params ────────────────────────────────────────────────────────────────

const _rawId = new URLSearchParams(window.location.search).get("id");
// Guard against stale "undefined" strings left in the URL
const docId = (_rawId && _rawId !== "undefined" && _rawId !== "null") ? _rawId : null;

// Embedded mode: ?chrome=minimal hides the back-link nav bar so the editor
// can be hosted inside another app's iframe without showing duplicate chrome.
const minimalChrome = new URLSearchParams(window.location.search).get("chrome") === "minimal";

// ── Save indicator ────────────────────────────────────────────────────────────

function buildSaveIndicator() {
  const el = document.createElement("div");
  el.id = "save-indicator";
  el.className = "save-indicator";
  // Slot inside the nav bar if it already exists, otherwise #editor-head
  const slot = document.getElementById("saveIndicatorSlot");
  if (slot) slot.appendChild(el);
  else document.getElementById("editor-head").appendChild(el);
  return {
    saving() { el.textContent = "Saving…"; el.className = "save-indicator saving"; },
    saved()  { el.textContent = "Saved ✓"; el.className = "save-indicator saved";  },
    clear()  { el.textContent = "";        el.className = "save-indicator";          },
  };
}

// ── Back-to-docs nav bar ──────────────────────────────────────────────────────

function buildNavBar(title) {
  // Remove existing nav bar if re-called (e.g. after auto-create)
  document.querySelector(".editor-nav")?.remove();

  const bar = document.createElement("div");
  bar.className = "editor-nav";
  bar.innerHTML = `
    <a href="/docs.html" class="editor-nav-back">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      All documents
    </a>
    <span class="editor-nav-title" id="editorNavTitle">${title ?? "Untitled document"}</span>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="saveVersionBtn" class="nav-version-btn" title="Save a named version of this document">
        🕓 Save version
      </button>
      <button id="historyBtn" class="nav-history-btn" title="View version history">
        History
      </button>
      <div id="saveIndicatorSlot"></div>
    </div>`;
  document.getElementById("editor-head").prepend(bar);

  bar.querySelector("#saveVersionBtn").addEventListener("click", () => openSaveVersionModal());
  bar.querySelector("#historyBtn").addEventListener("click", () => toggleVersionPanel());
}

// ── Version management ────────────────────────────────────────────────────────

function openSaveVersionModal() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || id === "undefined") return;

  document.querySelector(".version-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "version-modal-overlay";
  overlay.innerHTML = `
    <div class="version-modal">
      <div class="version-modal-title">🕓 Save Version</div>
      <div class="version-modal-sub">Give this version a label so you can find it later.</div>
      <input id="versionLabelInput" class="version-modal-input" placeholder="e.g. Client redline v2, After legal review…" />
      <div class="version-modal-btns">
        <button id="versionSaveBtn" class="version-modal-save">Save version</button>
        <button id="versionCancelBtn" class="version-modal-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#versionLabelInput");
  input.focus();

  overlay.querySelector("#versionCancelBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#versionSaveBtn").addEventListener("click", async () => {
    const label = input.value.trim();
    const btn = overlay.querySelector("#versionSaveBtn");
    btn.textContent = "Saving…";
    btn.disabled = true;
    try {
      const r = await fetch(`/api/docs/${id}/versions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label }),
      });
      if (r.ok) {
        overlay.remove();
        showVersionToast("Version saved ✓");
        // Refresh the panel if it's open
        const panel = document.getElementById("versionPanel");
        if (panel) loadVersionPanel(id, panel);
      } else {
        btn.textContent = "Save version";
        btn.disabled = false;
      }
    } catch {
      btn.textContent = "Save version";
      btn.disabled = false;
    }
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") overlay.querySelector("#versionSaveBtn").click();
    if (e.key === "Escape") overlay.remove();
  });
}

function showVersionToast(msg) {
  const t = document.createElement("div");
  t.className = "version-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("version-toast--visible"), 10);
  setTimeout(() => { t.classList.remove("version-toast--visible"); setTimeout(() => t.remove(), 300); }, 2500);
}

async function loadVersionPanel(id, panel) {
  panel.innerHTML = `<div class="vp-loading">Loading…</div>`;
  try {
    const r = await fetch(`/api/docs/${id}/versions`);
    const versions = await r.json();
    if (!versions.length) {
      panel.innerHTML = `<div class="vp-empty">
        <div class="vp-empty-icon">🕓</div>
        <div>No versions saved yet.</div>
        <div style="font-size:0.78rem;margin-top:4px;color:#94a3b8">Click "Save version" to snapshot the current state.</div>
      </div>`;
      return;
    }
    panel.innerHTML = `
      <div class="vp-header">
        <span class="vp-title">Version History</span>
        <button class="vp-close" id="vpClose">✕</button>
      </div>
      <div class="vp-list">
        ${versions.map((v, i) => `
          <div class="vp-item">
            <div class="vp-item-left">
              <div class="vp-version-num">v${v.version_num}</div>
              <div>
                <div class="vp-item-label">${v.label || `Version ${v.version_num}`}</div>
                <div class="vp-item-date">${new Date(v.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })}</div>
              </div>
            </div>
            <div class="vp-item-actions">
              <button class="vp-diff-btn"    data-idx="${i}" title="Compare with ${i === 0 ? "current document" : `v${versions[i-1].version_num}`}">↔ Diff</button>
              <button class="vp-restore-btn" data-vid="${v.id}" data-vnum="${v.version_num}">Restore</button>
              <button class="vp-delete-btn"  data-vid="${v.id}">🗑</button>
            </div>
          </div>`).join("")}
      </div>`;

    panel.querySelector("#vpClose").addEventListener("click", () => toggleVersionPanel(false));

    panel.querySelectorAll(".vp-restore-btn").forEach(btn => {
      btn.addEventListener("click", () => restoreVersion(id, btn.dataset.vid, btn.dataset.vnum));
    });

    panel.querySelectorAll(".vp-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this version?")) return;
        await fetch(`/api/docs/${id}/versions/${btn.dataset.vid}`, { method: "DELETE" });
        loadVersionPanel(id, panel);
      });
    });

    panel.querySelectorAll(".vp-diff-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const older = versions[idx];
        btn.textContent = "…";
        btn.disabled    = true;

        try {
          // "Older" side: always this version
          const olderFull  = await fetchVersionContent(id, older.id);
          const olderLabel = older.label || `v${older.version_num}`;
          const linesOld   = extractLines(olderFull.content);

          // "Newer" side: previous in list (lower idx) or current document
          let linesNew, newerLabel;
          if (idx === 0) {
            // Compare latest saved version → current unsaved document state
            const currentDoc = window.__editorView?.state.doc.toJSON();
            linesNew    = extractLines(currentDoc);
            newerLabel  = "Current document";
          } else {
            const newer      = versions[idx - 1];
            const newerFull  = await fetchVersionContent(id, newer.id);
            linesNew    = extractLines(newerFull.content);
            newerLabel  = newer.label || `v${newer.version_num}`;
          }

          openDiffModal(olderLabel, linesOld, newerLabel, linesNew);
        } catch (e) {
          alert("Could not load version content for diff.");
        } finally {
          btn.textContent = "↔ Diff";
          btn.disabled    = false;
        }
      });
    });
  } catch {
    panel.innerHTML = `<div class="vp-empty">Could not load versions.</div>`;
  }
}

async function restoreVersion(docId, versionId, vnum) {
  if (!confirm(`Restore to v${vnum}? The current document will be overwritten.\n\nTip: save the current state as a version first.`)) return;
  try {
    const r = await fetch(`/api/docs/${docId}/versions/${versionId}`);
    const v = await r.json();
    // Overwrite the document with the version's content
    await fetch(`/api/docs/${docId}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ content: v.content }),
    });
    showVersionToast(`Restored to v${vnum} ✓`);
    // Reload the page to reflect restored content
    setTimeout(() => window.location.reload(), 800);
  } catch {
    alert("Could not restore version.");
  }
}

// ── Diff modal ────────────────────────────────────────────────────────────────

function openDiffModal(labelOld, linesOld, labelNew, linesNew) {
  document.querySelector(".diff-modal-overlay")?.remove();

  const ops   = diffLines(linesOld, linesNew);
  const stats = diffStats(ops);

  const overlay = document.createElement("div");
  overlay.className = "diff-modal-overlay";

  // ── Build diff lines HTML ─────────────────────────────────────────────────
  const diffHTML = ops.map(op => {
    const cls    = op.op === "insert" ? "diff-line--insert"
                 : op.op === "delete" ? "diff-line--delete"
                 : "diff-line--equal";
    const prefix = op.op === "insert" ? "+" : op.op === "delete" ? "−" : " ";
    const text   = op.value.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<div class="diff-line ${cls}"><span class="diff-line-prefix">${prefix}</span>${text}</div>`;
  }).join("");

  const noChanges = stats.added === 0 && stats.removed === 0;

  overlay.innerHTML = `
    <div class="diff-modal">
      <div class="diff-modal-header">
        <div>
          <div class="diff-modal-title">↔ Document Diff</div>
          <div class="diff-modal-sub">
            <span class="diff-label-old">${labelOld}</span>
            <span class="diff-arrow">→</span>
            <span class="diff-label-new">${labelNew}</span>
          </div>
        </div>
        <button class="diff-close-btn" title="Close">✕</button>
      </div>
      <div class="diff-stats">
        <span class="diff-stat diff-stat--add">+${stats.added} added</span>
        <span class="diff-stat-sep">·</span>
        <span class="diff-stat diff-stat--del">−${stats.removed} removed</span>
        <span class="diff-stat-sep">·</span>
        <span class="diff-stat diff-stat--eq">${stats.unchanged} unchanged</span>
      </div>
      <div class="diff-body">
        ${noChanges
          ? `<div class="diff-no-changes">✓ No text differences between these versions.</div>`
          : diffHTML}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector(".diff-close-btn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// ── Fetch version content helper ──────────────────────────────────────────────

async function fetchVersionContent(docId, versionId) {
  const r = await fetch(`/api/docs/${docId}/versions/${versionId}`);
  if (!r.ok) throw new Error("Version not found");
  return r.json();
}

function toggleVersionPanel(forceOpen) {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || id === "undefined") return;

  let panel = document.getElementById("versionPanel");
  const shouldOpen = forceOpen ?? !panel;

  if (!shouldOpen) { panel?.remove(); return; }
  if (panel) return; // already open

  panel = document.createElement("div");
  panel.id = "versionPanel";
  panel.className = "version-panel";
  document.body.appendChild(panel);
  loadVersionPanel(id, panel);
}

// ── Extract H1 title from doc ─────────────────────────────────────────────────

function extractTitle(doc) {
  let title = "";
  doc.forEach(node => {
    if (!title && node.type === schema.nodes.heading && node.attrs.level === 1) {
      title = node.textContent.trim();
    }
  });
  return title || "Untitled document";
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

function buildAutoSave(indicator, getDocId) {
  let timer = null;
  return function schedule(view) {
    indicator.saving();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = getDocId();
      if (!id) return;
      const title = extractTitle(view.state.doc);
      const docJson = view.state.doc.toJSON();
      console.log("[autosave] saving id:", id, "node types:", docJson.content?.map(n => n.type));
      const saveRes = await fetch(`/api/docs/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ content: docJson, title }),
      }).catch(e => { console.error("[autosave] fetch error:", e); });
      if (saveRes && !saveRes.ok) console.error("[autosave] server error:", saveRes.status, await saveRes.text());
      // Update nav title live
      const navTitle = document.getElementById("editorNavTitle");
      if (navTitle) navTitle.textContent = title;
      indicator.saved();
      setTimeout(() => indicator.clear(), 2000);
    }, 800);
  };
}

// ── Placeholder plugin ────────────────────────────────────────────────────────

function placeholderPlugin(text) {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        if (
          doc.childCount === 1 &&
          doc.firstChild.isTextblock &&
          doc.firstChild.content.size === 0
        ) {
          const deco = Decoration.node(0, doc.content.size, {
            "data-placeholder": text,
            class: "is-empty",
          });
          return DecorationSet.create(doc, [deco]);
        }
        return DecorationSet.empty;
      },
    },
  });
}

// ── Input rules ───────────────────────────────────────────────────────────────

function buildInputRules() {
  const { nodes } = schema;
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, m => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/,           nodes.blockquote),
      wrappingInputRule(/^\s*([-*])\s$/,      nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/,        nodes.ordered_list),
    ],
  });
}

// ── Default scratch doc ───────────────────────────────────────────────────────

const scratchDoc = schema.node("doc", null, [
  schema.node("heading", { level: 1 }, [schema.text("Welcome to ProseMirror!")]),
  schema.node("paragraph", null, [
    schema.text("Use the toolbar above or keyboard shortcuts to format text. Try "),
    schema.text("bold",        [schema.marks.strong.create()]),
    schema.text(", "),
    schema.text("italic",      [schema.marks.em.create()]),
    schema.text(", or "),
    schema.text("inline code", [schema.marks.code.create()]),
    schema.text("."),
  ]),
  schema.node("paragraph", null, [
    schema.text("Tip: type # for a heading, > for a blockquote, or - for a bullet list."),
  ]),
]);

// ── Right rail: document properties ──────────────────────────────────────────

async function mountRailProps(docId) {
  const rail = document.getElementById("rail-props");
  if (!rail) return;

  try {
    const [docRes, collsRes] = await Promise.all([
      fetch(`/api/docs/${docId}`),
      fetch("/api/collections"),
    ]);
    if (!docRes.ok) return;
    const doc  = await docRes.json();
    const colls = collsRes.ok ? await collsRes.json() : [];

    const collection = colls.find(c => c.id === doc.collection_id);

    const fmt = d => d
      ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

    // Rough word count from document JSON
    function countWords(node) {
      if (!node) return 0;
      if (node.text) return node.text.trim().split(/\s+/).filter(Boolean).length;
      return (node.content || []).reduce((s, n) => s + countWords(n), 0);
    }
    const words = countWords(doc.content);

    rail.innerHTML = `
      <div class="rail-section">
        <div class="rail-section-label">Document</div>
        ${collection ? `
          <div class="rail-prop">
            <span class="rail-prop-label">Collection</span>
            <span class="rail-prop-value" style="display:flex;align-items:center;gap:5px">
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                <path d="M1.5 4a1 1 0 0 1 1-1h3.25l1.25 1.5H12.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4Z"
                  fill="${collection.color}20" stroke="${collection.color}" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
              ${collection.name}
            </span>
          </div>
        ` : ""}
        <div class="rail-prop">
          <span class="rail-prop-label">Words</span>
          <span class="rail-prop-value">${words.toLocaleString()}</span>
        </div>
        <div class="rail-prop">
          <span class="rail-prop-label">Created</span>
          <span class="rail-prop-value">${fmt(doc.created_at)}</span>
        </div>
        <div class="rail-prop">
          <span class="rail-prop-label">Modified</span>
          <span class="rail-prop-value">${fmt(doc.updated_at)}</span>
        </div>
      </div>`;
  } catch (e) {
    console.warn("Rail props load failed", e);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  // Load extension config (null = all enabled if API unavailable)
  let extConfig = null;
  try {
    const cfgRes = await fetch("/api/extensions/config");
    if (cfgRes.ok) extConfig = await cfgRes.json();
  } catch { /* server offline — show all buttons */ }

  // Load doc from DB if ?id= is present
  let initialDoc = scratchDoc;
  let savedTitle = null;

  if (docId) {
    try {
      const res = await fetch(`/api/docs/${docId}`);
      if (res.ok) {
        const row = await res.json();
        initialDoc = schema.nodeFromJSON(row.content);
        savedTitle = row.title || extractTitle(initialDoc);
      } else if (res.status === 404) {
        // Document was deleted — go back to the doc list
        window.location.replace("/docs.html");
        return;
      }
    } catch (e) {
      console.error("[init] Could not load document:", e);
    }

    if (!minimalChrome) buildNavBar(savedTitle);
  }

  // If no ?id= param, auto-create a document on first edit and redirect
  let currentDocId = docId;
  let autoCreatePending = !docId;

  const indicator = buildSaveIndicator();
  if (!docId) indicator.clear(); // hide until first edit

  const scheduleAutoSave = buildAutoSave(indicator, () => currentDocId);

  const state = EditorState.create({
    schema,
    doc: initialDoc,
    plugins: [
      history(),
      columnResizing(),
      tableEditing(),
      tableHoverPlugin(),
      keymap({ "Tab": goToNextCell(1), "Shift-Tab": goToNextCell(-1) }),
      editorKeymap,
      buildInputRules(),
      placeholderPlugin("Start writing…"),
      menuPlugin("#toolbar", extConfig),
      dragHandlePlugin(),
    ],
  });

  const view = new EditorView(document.querySelector("#editor"), {
    state,
    nodeViews: {
      graph:      (node, view, getPos) => new GraphNodeView(node, view, getPos),
      map:        (node, view, getPos) => new MapNodeView(node, view, getPos),
      diagram:    (node, view, getPos) => new DiagramNodeView(node, view, getPos),
      product:    (node, view, getPos) => new ProductNodeView(node, view, getPos),
      fhir:       (node, view, getPos) => new FhirNodeView(node, view, getPos),
      form:       (node, view, getPos) => new FormNodeView(node, view, getPos),
      kanban:     (node, view, getPos) => new KanbanNodeView(node, view, getPos),
      reply:      (node, view, getPos) => new ReplyNodeView(node, view, getPos),
      assetGraph: (node, view, getPos) => new AssetGraphNodeView(node, view, getPos),
      carGraph:   (node, view, getPos) => new CarGraphNodeView(node, view, getPos),
      subGraph:     (node, view, getPos) => new SubGraphNodeView(node, view, getPos),
      meetingNotes:  (node, view, getPos) => new MeetingNotesNodeView(node, view, getPos),
      markdownBlock: (node, view, getPos) => new MarkdownBlockNodeView(node, view, getPos),
      graphBuilder:  (node, view, getPos) => new GraphBuilderNodeView(node, view, getPos),
      imageBlock:    (node, view, getPos) => new ImageBlockNodeView(node, view, getPos),
      moleculeBlock: (node, view, getPos) => new MoleculeBlockNodeView(node, view, getPos),
      riskMatrix:    (node, view, getPos) => new RiskMatrixNodeView(node, view, getPos),
      customerBlock: (node, view, getPos) => new CustomerBlockNodeView(node, view, getPos),
      clauseBlock:   (node, view, getPos) => new ClauseBlockNodeView(node, view, getPos),
      partyBlock:    (node, view, getPos) => new PartyBlockNodeView(node, view, getPos),
      matterBlock:      (node, view, getPos) => new MatterBlockNodeView(node, view, getPos),
      versionTimeline:  (node, view, getPos) => new VersionTimelineNodeView(node, view, getPos),
      maintenanceBlock: (node, view, getPos) => new MaintenanceBlockNodeView(node, view, getPos),
      bomBlock:         (node, view, getPos) => new BomBlockNodeView(node, view, getPos),
      mermaidBlock:     (node, view, getPos) => new MermaidBlockNodeView(node, view, getPos),
      todoBlock:        (node, view, getPos) => new TodoBlockNodeView(node, view, getPos),
      assetRef:         (node, view, getPos) => new AssetRefNodeView(node, view, getPos),
    },

    // ── Drop image files anywhere in the document ────────────────────────────
    handleDrop(view, event) {
      const files = [...(event.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
      if (!files.length) return false;           // let ProseMirror handle non-image drops

      event.preventDefault();
      view.dom.classList.remove("pm-drag-over");

      // Resolve drop position from pointer coordinates
      const coords = { left: event.clientX, top: event.clientY };
      const dropped = view.posAtCoords(coords);
      if (!dropped) return true;

      files.forEach(async file => {
        // Insert a placeholder block immediately so the user gets feedback
        const nodeType = view.state.schema.nodes.imageBlock;
        if (!nodeType) return;

        // Upload
        const fd = new FormData();
        fd.append("file", file);
        try {
          const res  = await fetch("/api/upload", { method: "POST", body: fd });
          const data = await res.json();
          if (!data.url) throw new Error(data.error || "Upload failed");

          // Insert imageBlock at the drop position
          const node = nodeType.create({ src: data.url, alt: file.name.replace(/\.[^.]+$/, "") });
          // Re-resolve position (doc may have changed while uploading)
          const pos = Math.min(dropped.pos, view.state.doc.content.size);
          view.dispatch(view.state.tr.insert(pos, node).scrollIntoView());
        } catch (err) {
          console.error("Image drop upload failed:", err);
        }
      });

      return true;
    },

    // ── Paste image from clipboard (Ctrl+V / screenshot paste) ───────────────
    handlePaste(view, event) {
      const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
      if (!files.length) return false;

      event.preventDefault();

      files.forEach(async file => {
        const nodeType = view.state.schema.nodes.imageBlock;
        if (!nodeType) return;

        const fd = new FormData();
        fd.append("file", file);
        try {
          const res  = await fetch("/api/upload", { method: "POST", body: fd });
          const data = await res.json();
          if (!data.url) throw new Error(data.error || "Upload failed");

          const node = nodeType.create({ src: data.url, alt: "Pasted image" });
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        } catch (err) {
          console.error("Image paste upload failed:", err);
        }
      });

      return true;
    },

    // ── Drag-over highlight on the editor itself ──────────────────────────────
    handleDOMEvents: {
      dragover(view, event) {
        const hasImage = [...(event.dataTransfer?.items || [])].some(
          i => i.kind === "file" && i.type.startsWith("image/")
        );
        if (hasImage) {
          event.preventDefault();
          view.dom.classList.add("pm-drag-over");
        }
        return false;
      },
      dragleave(view) {
        view.dom.classList.remove("pm-drag-over");
        return false;
      },
      drop(view) {
        view.dom.classList.remove("pm-drag-over");
        return false;
      },
    },

    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (!tr.docChanged) return;

      // First edit with no ?id= → create a new document and update the URL
      if (autoCreatePending) {
        autoCreatePending = false;
        const newId = crypto.randomUUID();
        currentDocId = newId; // set immediately so autosave can fire
        const title = extractTitle(next.doc);
        // Update URL right away — no reload
        window.history.replaceState({}, "", `/?id=${newId}`);
        fetch("/api/docs", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ id: newId, content: next.doc.toJSON(), title }),
        })
          .then(() => { if (!minimalChrome) buildNavBar(title); })
          .catch(() => {});
      }

      scheduleAutoSave(view);
    },
  });

  window.__editorView = view;

  // ── Sidebar + right rail ─────────────────────────────────────────────────────
  const sidebarEl = document.getElementById("editor-sidebar");
  if (sidebarEl) mountEditorSidebar(sidebarEl, currentDocId);

  // ── Rail: document properties ────────────────────────────────────────────────
  if (docId) mountRailProps(docId);

  // ── Rail: related documents section ─────────────────────────────────────────
  if (docId) {
    const { mountDocLinksSection } = await import("./docLinks.js");
    const linksContainer = document.getElementById("docLinksSection");
    if (linksContainer) {
      mountDocLinksSection(linksContainer, docId, {
        readOnly:  false,
        fromTitle: savedTitle ?? "",
      });
    }
  }
}

init();
