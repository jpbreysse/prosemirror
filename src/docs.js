/**
 * docs.js — Document browser page
 *
 * Lists all documents stored in PostgreSQL.
 * Click a card to open it in the editor (index.html?id=<uuid>).
 * "New document" creates an empty doc then redirects.
 */

import "./docs.css";
import { importDocx, extractDocTitle } from "./utils/docxImporter.js";

const API = "/api/docs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(title) {
  return (title || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Deterministic pastel colour from a string
function titleColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 60%, 88%)`;
}
function titleTextColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 50%, 35%)`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderApp(docs) {
  const root = document.getElementById("docs-app");

  root.innerHTML = `
    <div class="docs-layout">
      <header class="docs-header">
        <div class="docs-header-left">
          <div class="docs-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="#6366f1"/>
              <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <h1 class="docs-title">Documents</h1>
            <p class="docs-subtitle">${docs.length} document${docs.length !== 1 ? "s" : ""} in workspace</p>
          </div>
        </div>
        <div class="docs-header-actions">
          <button class="docs-import-btn" id="importDocxBtn" title="Import a .docx file">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Import .docx
          </button>
          <button class="docs-new-btn" id="newDocBtn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            New document
          </button>
          <input type="file" id="docxFileInput" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none"/>
        </div>
      </header>

      <div id="importDropZone" class="docs-drop-zone" style="display:none">
        <div class="docs-drop-zone-inner">
          <div class="docs-drop-icon">📄</div>
          <div class="docs-drop-label">Drop your .docx file here</div>
        </div>
      </div>

      <div class="docs-search-bar">
        <svg class="docs-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="#9ca3af" stroke-width="1.5"/>
          <path d="M10.5 10.5L13 13" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input class="docs-search-input" id="searchInput" type="text" placeholder="Search documents…"/>
      </div>

      <div class="docs-grid" id="docsGrid">
        ${docs.length === 0 ? renderEmpty() : docs.map(renderCard).join("")}
      </div>
    </div>`;

  // New document
  document.getElementById("newDocBtn").addEventListener("click", newDocument);

  // Import .docx — button click opens file picker
  document.getElementById("importDocxBtn").addEventListener("click", () => {
    document.getElementById("docxFileInput").click();
  });

  document.getElementById("docxFileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importDocxFile(file);
    e.target.value = ""; // reset so same file can be re-selected
  });

  // Drag-and-drop .docx onto the page
  setupDragDrop();

  // Card click → read view
  document.getElementById("docsGrid").addEventListener("click", e => {
    const card = e.target.closest(".docs-card[data-id]");
    if (card) readDoc(card.dataset.id);
  });

  // Edit icon button → editor
  document.getElementById("docsGrid").addEventListener("click", e => {
    const btn = e.target.closest(".docs-card-edit");
    if (!btn) return;
    e.stopPropagation();
    openDoc(btn.dataset.id);
  });

  // Delete buttons
  document.getElementById("docsGrid").addEventListener("click", async e => {
    const btn = e.target.closest(".docs-card-delete");
    if (!btn) return;
    e.stopPropagation();
    const id    = btn.dataset.id;
    const title = btn.dataset.title;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await fetch(`${API}/${id}`, { method: "DELETE" });
    await loadAndRender();
  });

  // Live search filter
  document.getElementById("searchInput").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".docs-card[data-id]").forEach(card => {
      const title = card.dataset.title.toLowerCase();
      card.style.display = title.includes(q) ? "" : "none";
    });
  });
}

function renderCard(doc) {
  const bg   = titleColor(doc.title);
  const fg   = titleTextColor(doc.title);
  const init = initials(doc.title);
  const when = relativeTime(doc.updated_at);

  return `
    <div class="docs-card" data-id="${doc.id}" data-title="${escHtml(doc.title)}" title="Read document">
      <div class="docs-card-thumb" style="background:${bg}; color:${fg}">${init}</div>
      <div class="docs-card-body">
        <div class="docs-card-title">${escHtml(doc.title) || "<em>Untitled</em>"}</div>
        <div class="docs-card-meta">
          <span class="docs-card-time">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M6 3.5V6l1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            ${when}
          </span>
          <span class="docs-card-id">${doc.id.slice(0, 8)}…</span>
        </div>
      </div>
      <div class="docs-card-actions">
        <button class="docs-card-edit" data-id="${doc.id}" title="Edit document">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="docs-card-delete" data-id="${doc.id}" data-title="${escHtml(doc.title)}" title="Delete document">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function renderEmpty() {
  return `
    <div class="docs-empty">
      <div class="docs-empty-icon">📄</div>
      <div class="docs-empty-title">No documents yet</div>
      <div class="docs-empty-sub">Click <strong>New document</strong> to get started.</div>
    </div>`;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Actions ───────────────────────────────────────────────────────────────────

function readDoc(id) {
  window.location.href = `/reader.html?id=${id}`;
}

function openDoc(id) {
  window.location.href = `/?id=${id}`;
}

async function newDocument() {
  const btn = document.getElementById("newDocBtn");
  btn.disabled = true;
  btn.textContent = "Creating…";

  const id      = randomId();
  const title   = "Untitled document";
  const content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      { type: "paragraph", content: [] },
    ],
  };

  await fetch(API, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ id, content, title }),
  });

  window.location.href = `/?id=${id}`;
}

// ── .docx import ─────────────────────────────────────────────────────────────

async function importDocxFile(file) {
  const btn = document.getElementById("importDocxBtn");

  // Show progress state
  if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }
  showImportToast("Parsing document…", "info");

  try {
    const docJson = await importDocx(file);
    const title   = extractDocTitle(docJson);
    const id      = randomId();

    const res = await fetch(API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id, content: docJson, title }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);

    showImportToast(`Imported "${title}" ✓`, "success");
    setTimeout(() => { window.location.href = `/?id=${id}`; }, 600);

  } catch (err) {
    console.error("docx import failed:", err);
    showImportToast(`Import failed: ${err.message}`, "error");
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Import .docx`; }
  }
}

function showImportToast(msg, type = "info") {
  document.querySelector(".docs-import-toast")?.remove();
  const t = document.createElement("div");
  t.className = `docs-import-toast docs-import-toast--${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("docs-import-toast--visible"));
  if (type !== "info") {
    setTimeout(() => {
      t.classList.remove("docs-import-toast--visible");
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }
}

function setupDragDrop() {
  const dropZone = document.getElementById("importDropZone");
  if (!dropZone) return;

  let dragCounter = 0;

  document.addEventListener("dragenter", e => {
    const hasDocx = [...(e.dataTransfer?.items || [])].some(
      i => i.kind === "file" && (
        i.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        i.type === ""  // type may be empty for local files
      )
    );
    if (!hasDocx && e.dataTransfer?.items?.length) return;
    dragCounter++;
    dropZone.style.display = "flex";
    e.preventDefault();
  });

  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropZone.style.display = "none"; }
  });

  document.addEventListener("dragover", e => { e.preventDefault(); });

  document.addEventListener("drop", e => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.style.display = "none";

    const file = [...(e.dataTransfer?.files || [])].find(
      f => f.name.toLowerCase().endsWith(".docx")
    );
    if (file) importDocxFile(file);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function loadAndRender() {
  let res;
  try {
    res = await fetch(API);
  } catch {
    renderApiError();
    return;
  }
  if (!res.ok) { renderApiError(); return; }
  const docs = await res.json();
  renderApp(docs);
}

function renderApiError() {
  document.getElementById("docs-app").innerHTML = `
    <div class="docs-layout">
      <header class="docs-header">
        <div class="docs-header-left">
          <div class="docs-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="#6366f1"/>
              <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <h1 class="docs-title">Documents</h1>
          </div>
        </div>
      </header>
      <div class="docs-api-error">
        <div class="docs-api-error-icon">⚠️</div>
        <div class="docs-api-error-title">API server is not running</div>
        <div class="docs-api-error-sub">
          Start it with <code>npm run dev</code> or <code>node server.js</code> in your terminal,
          then <a href="" onclick="location.reload();return false;">reload this page</a>.
        </div>
      </div>
    </div>`;
}

loadAndRender();
