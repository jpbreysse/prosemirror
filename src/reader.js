/**
 * reader.js — Read-only document view
 *
 * Loads a document from PostgreSQL by ?id= URL param and renders it
 * in a read-only ProseMirror EditorView.
 *
 * All custom NodeViews (graphs, kanban, reply blocks…) remain fully
 * interactive — only typing/editing is disabled.
 */

import "./editor.css";
import "./reader.css";

import { EditorState }        from "prosemirror-state";
import { EditorView }         from "prosemirror-view";

import { schema }             from "./schema.js";

// ── NodeViews (same set as main.js) ──────────────────────────────────────────
import { GraphNodeView }      from "./extensions/graph/nodeView.js";
import { MapNodeView }        from "./extensions/map/nodeView.js";
import { DiagramNodeView }    from "./extensions/diagram/nodeView.js";
import { ProductNodeView }    from "./extensions/product/nodeView.js";
import { FhirNodeView }       from "./extensions/fhir/nodeView.js";
import { FormNodeView }       from "./extensions/form/nodeView.js";
import { KanbanNodeView }     from "./extensions/kanban/nodeView.js";
import { ReplyNodeView }      from "./extensions/reply/nodeView.js";
import { AssetGraphNodeView } from "./extensions/assetGraph/nodeView.js";
import { CarGraphNodeView }     from "./extensions/carGraph/nodeView.js";
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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);
  const docId  = params.get("id");

  if (!docId) {
    showError("No document ID supplied. <a href='/docs.html'>← Back to documents</a>");
    return;
  }

  // ── Fetch doc from API ─────────────────────────────────────────────────────
  let row;
  try {
    const res = await fetch(`/api/docs/${docId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    row = await res.json();
  } catch (err) {
    showError(`Could not load document: ${err.message}. <a href='/docs.html'>← Back</a>`);
    return;
  }

  // ── Parse doc JSON ─────────────────────────────────────────────────────────
  let doc;
  try {
    doc = schema.nodeFromJSON(row.content);
  } catch (err) {
    showError(`Document could not be parsed: ${err.message}`);
    return;
  }

  // ── Page title ────────────────────────────────────────────────────────────
  const title = row.title || "Untitled";
  document.title = title;

  // ── Nav bar ───────────────────────────────────────────────────────────────
  buildNav(title, docId);
  checkAutoPrint();

  // ── Read-only EditorView ──────────────────────────────────────────────────
  const state = EditorState.create({ doc, schema });

  new EditorView(document.getElementById("reader-content"), {
    state,

    // The single prop that switches ProseMirror to read-only mode
    editable: () => false,

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
    },

    // Suppress the default editable cursor style
    attributes: { class: "reader-pm-content" },
  });
}

// ── Nav bar ───────────────────────────────────────────────────────────────────

function buildNav(title, docId) {
  const nav = document.getElementById("reader-nav");
  nav.innerHTML = `
    <a class="rn-back" href="/docs.html">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      All documents
    </a>
    <span class="rn-title">${escHtml(title)}</span>
    <button class="rn-pdf-btn" id="exportPdfBtn">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="8" height="11" rx="1" stroke="currentColor" stroke-width="1.4"/>
        <path d="M5 5h4M5 7.5h4M5 10h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M10 9l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Export PDF
    </button>
    <a class="rn-edit-btn" href="/?id=${docId}">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5Z" stroke="currentColor" stroke-width="1.5"
          stroke-linejoin="round"/>
      </svg>
      Edit
    </a>`;

  // Wire up the export button
  document.getElementById("exportPdfBtn").addEventListener("click", () => {
    // Inject a temporary doc header visible only during print
    const existing = document.getElementById("print-doc-header");
    if (existing) existing.remove();
    const header = document.createElement("div");
    header.id = "print-doc-header";
    header.className = "print-doc-header";
    header.innerHTML = `
      <div class="print-doc-header-title">${escHtml(title)}</div>
      <div class="print-doc-header-meta">
        Exported: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}<br>
        Document ID: ${docId}
      </div>`;
    const content = document.getElementById("reader-content");
    content.insertBefore(header, content.firstChild);
    window.print();
    // Remove after print dialog closes
    setTimeout(() => header.remove(), 1000);
  });
}

// ── Auto-print when ?print=1 is in the URL ────────────────────────────────────

function checkAutoPrint() {
  if (new URLSearchParams(window.location.search).get("print") === "1") {
    // Wait for NodeViews to fully render
    setTimeout(() => window.print(), 800);
  }
}

// ── Error helper ──────────────────────────────────────────────────────────────

function showError(html) {
  document.getElementById("reader-body").innerHTML =
    `<div class="reader-error">${html}</div>`;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();
