/**
 * docs.js — Document browser with collections + tags
 */

import "./docs.css";
import { importDocx, extractDocTitle } from "./utils/docxImporter.js";
import { importPdf,  extractPdfTitle  } from "./utils/pdfImporter.js";

const API      = "/api/docs";
const COLL_API = "/api/collections";

// ── State ─────────────────────────────────────────────────────────────────────

let allDocs         = [];
let allCollections  = [];
let selectedIds     = new Set();
let sortBy          = "updated_at";
let sortDir         = "desc";
let filterFrom      = "";
let filterTo        = "";
let searchQuery     = "";
// Restore activeView from URL so navigating back to docs keeps the collection selected
let activeView      = new URLSearchParams(window.location.search).get("collection") || "all";
let activeTagFilter = [];      // tag strings currently active

const COLL_COLORS = [
  "#6366f1","#ec4899","#f59e0b","#10b981",
  "#3b82f6","#8b5cf6","#ef4444","#14b8a6",
  "#f97316","#64748b",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function relativeTime(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtBytes(n) {
  if (n < 1024)         return `${n} B`;
  if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(title) {
  return (title || "?").split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

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

function tagColors(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return { bg: `hsl(${h % 360}, 70%, 92%)`, fg: `hsl(${h % 360}, 55%, 28%)` };
}

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getAllUniqueTags() {
  const seen = new Set();
  allDocs.forEach(d => (d.tags || []).forEach(t => seen.add(t)));
  return [...seen].sort();
}

// ── Filtering + sorting ───────────────────────────────────────────────────────

function applyFilters(docs) {
  let result = docs.filter(d => {
    // Collection filter
    if (activeView === "uncategorized") {
      if (d.collection_ids?.length) return false;
    } else if (activeView !== "all") {
      if (!d.collection_ids?.includes(activeView)) return false;
    }
    // Tag filter (doc must have ALL active tags)
    if (activeTagFilter.length) {
      if (!activeTagFilter.every(t => (d.tags || []).includes(t))) return false;
    }
    // Search: matches title or any tag
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (d.title || "").toLowerCase().includes(q);
      const matchTags  = (d.tags || []).some(t => t.toLowerCase().includes(q));
      if (!matchTitle && !matchTags) return false;
    }
    // Date range
    if (filterFrom && new Date(d.created_at) < new Date(filterFrom)) return false;
    if (filterTo) {
      const to = new Date(filterTo); to.setHours(23, 59, 59, 999);
      if (new Date(d.created_at) > to) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    let va = a[sortBy] ?? "";
    let vb = b[sortBy] ?? "";
    if (sortBy === "title")       { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    else if (sortBy === "word_count") { va = va || 0; vb = vb || 0; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ?  1 : -1;
    return 0;
  });

  return result;
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadDocs() {
  const r = await fetch(API);
  if (!r.ok) throw new Error(`Docs API error ${r.status}`);
  allDocs = await r.json();
}

async function loadCollections() {
  try {
    const r = await fetch(COLL_API);
    if (r.ok) allCollections = await r.json();
  } catch { allCollections = []; }
}

async function reload() {
  await Promise.all([loadDocs(), loadCollections()]);
  renderSidebar();
  renderGrid();
  loadStats();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

// Global stats (whole library) — fetched once from server
let _globalStats = null;

async function loadStats() {
  try {
    const r = await fetch(`${API}/stats`);
    _globalStats = await r.json();
  } catch { /* non-critical */ }
  renderStats(allDocs); // will use global stats when view is "all"
}

// Re-render stat cards based on current view.
// When "all" → use server totals (incl. accurate byte size).
// When filtered → compute from the visible subset.
function renderStats(visible) {
  const storageLabel = document.getElementById("statStorageLabel");

  if (activeView === "all" && _globalStats) {
    document.getElementById("statTotalDocs").textContent    = _globalStats.total_docs        ?? 0;
    document.getElementById("statVersions").textContent     = _globalStats.total_versions    ?? 0;
    document.getElementById("statActiveWeek").textContent   = _globalStats.active_this_week  ?? 0;
    document.getElementById("statCreatedMonth").textContent = _globalStats.created_this_month ?? 0;
    document.getElementById("statStorage").textContent      = fmtBytes(_globalStats.total_bytes ?? 0);
    if (storageLabel) storageLabel.textContent = "Storage used";
    return;
  }

  // Filtered view — compute client-side from visible docs
  const now        = new Date();
  const weekAgo    = new Date(now); weekAgo.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalVersions    = visible.reduce((s, d) => s + (d.version_count || 0), 0);
  const activeThisWeek   = visible.filter(d => d.updated_at && new Date(d.updated_at) >= weekAgo).length;
  const createdThisMonth = visible.filter(d => d.created_at && new Date(d.created_at) >= monthStart).length;
  const totalWords       = visible.reduce((s, d) => s + (d.word_count || 0), 0);

  document.getElementById("statTotalDocs").textContent    = visible.length;
  document.getElementById("statVersions").textContent     = totalVersions;
  document.getElementById("statActiveWeek").textContent   = activeThisWeek;
  document.getElementById("statCreatedMonth").textContent = createdThisMonth;
  document.getElementById("statStorage").textContent      = totalWords.toLocaleString();
  if (storageLabel) storageLabel.textContent = "Total words";
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const sidebar = document.getElementById("docsSidebar");
  if (!sidebar) return;

  const uncatCount = allDocs.filter(d => !(d.collection_ids?.length)).length;

  sidebar.innerHTML = `
    <div class="docs-sidebar-header">
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#6366f1"/>
        <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="docs-sidebar-brand">v${__APP_VERSION__}</span>
    </div>

    <nav class="docs-sidebar-nav">
      <button class="docs-sidebar-item ${activeView === "all" ? "docs-sidebar-item--active" : ""}" data-view="all">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
          <rect x="8" y="1" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
          <rect x="1" y="8" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
          <rect x="8" y="8" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        All Documents
        <span class="docs-sidebar-count">${allDocs.length}</span>
      </button>
      <button class="docs-sidebar-item ${activeView === "uncategorized" ? "docs-sidebar-item--active" : ""}" data-view="uncategorized">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        Uncategorized
        <span class="docs-sidebar-count">${uncatCount}</span>
      </button>

      ${allCollections.length ? `<div class="docs-sidebar-divider"></div><div class="docs-sidebar-section-label">Collections</div>` : ""}

      ${allCollections.map(c => `
        <div class="docs-sidebar-coll-row ${activeView === c.id ? "docs-sidebar-coll-row--active" : ""}" data-view="${c.id}">
          <svg class="docs-sidebar-coll-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 4a1 1 0 0 1 1-1h3.25l1.25 1.5H12.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4Z"
              fill="${c.color}20" stroke="${c.color}" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="docs-sidebar-coll-name">${escHtml(c.name)}</span>
          <span class="docs-sidebar-count">${c.doc_count}</span>
          <span class="docs-sidebar-coll-btns">
            <button class="docs-sidebar-coll-btn" data-edit-coll="${c.id}" title="Rename">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M8 2l2 2L3.5 10H1.5V8L8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="docs-sidebar-coll-btn docs-sidebar-coll-btn--del" data-del-coll="${c.id}" data-del-name="${escHtml(c.name)}" title="Delete">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </button>
          </span>
        </div>
      `).join("")}

      <button class="docs-sidebar-new-coll" id="newCollBtn">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        New collection
      </button>
    </nav>

    <div class="docs-sidebar-footer">
      <a class="docs-sidebar-footer-link" href="/extensions.html">Extensions</a>
      <a class="docs-sidebar-footer-link" href="/connectors.html">Connectors</a>
      <a class="docs-sidebar-footer-link" href="/audit.html">Audit Log</a>
    </div>
  `;

  // Nav item clicks
  sidebar.querySelectorAll("[data-view]").forEach(el => {
    el.addEventListener("click", () => {
      activeView = el.dataset.view;
      // Persist in URL so coming back from the editor keeps the collection selected
      const url = new URL(window.location);
      if (activeView === "all") url.searchParams.delete("collection");
      else url.searchParams.set("collection", activeView);
      window.history.replaceState({}, "", url);
      renderSidebar();
      renderGrid();
    });
  });

  document.getElementById("newCollBtn")?.addEventListener("click", () => openCollectionModal(null));

  sidebar.querySelectorAll("[data-edit-coll]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); openCollectionModal(btn.dataset.editColl); });
  });

  sidebar.querySelectorAll("[data-del-coll]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm(`Delete collection "${btn.dataset.delName}"?\n\nDocuments will not be deleted.`)) return;
      await fetch(`${COLL_API}/${btn.dataset.delColl}`, { method: "DELETE" });
      if (activeView === btn.dataset.delColl) activeView = "all";
      await reload();
    });
  });
}

// ── Tag chips ─────────────────────────────────────────────────────────────────

function renderTagChips(tags, { clickable = false, removable = false } = {}) {
  if (!tags?.length) return "";
  return tags.map(tag => {
    const { bg, fg } = tagColors(tag);
    if (clickable) {
      const isActive = activeTagFilter.includes(tag);
      return `<button class="docs-tag docs-tag--clickable${isActive ? " docs-tag--active" : ""}" data-tag="${escHtml(tag)}" style="background:${bg};color:${fg}">${escHtml(tag)}</button>`;
    }
    if (removable) {
      return `<span class="docs-tag" style="background:${bg};color:${fg}">${escHtml(tag)}<button class="docs-tag-remove" data-remove-tag="${escHtml(tag)}" title="Remove">×</button></span>`;
    }
    return `<span class="docs-tag" style="background:${bg};color:${fg}">${escHtml(tag)}</span>`;
  }).join("");
}

// ── App shell ─────────────────────────────────────────────────────────────────

function renderApp() {
  const root = document.getElementById("docs-app");
  root.innerHTML = `
    <div class="docs-shell">
      <aside class="docs-sidebar" id="docsSidebar"></aside>
      <div class="docs-main">
        <div class="docs-layout">

          <!-- Header -->
          <header class="docs-header">
            <div class="docs-header-left">
              <div>
                <h1 class="docs-title">Documents</h1>
                <p class="docs-subtitle" id="docsSubtitle">${allDocs.length} document${allDocs.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <div class="docs-header-actions">
              <button class="docs-import-btn" id="importDocxBtn" title="Import a .docx file">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Import .docx
              </button>
              <button class="docs-import-btn" id="importPdfBtn" title="Import a PDF file">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Import PDF
              </button>
              <button class="docs-new-btn" id="newDocBtn">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                New document
              </button>
              <input type="file" id="docxFileInput" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none"/>
              <input type="file" id="pdfFileInput" accept=".pdf,application/pdf" style="display:none"/>
            </div>
          </header>

          <!-- Stats bar -->
          <div class="docs-stats-bar">
            <div class="docs-stat-card">
              <div class="docs-stat-value" id="statTotalDocs">—</div>
              <div class="docs-stat-label">Total documents</div>
            </div>
            <div class="docs-stat-card">
              <div class="docs-stat-value" id="statVersions">—</div>
              <div class="docs-stat-label">Saved versions</div>
            </div>
            <div class="docs-stat-card">
              <div class="docs-stat-value" id="statActiveWeek">—</div>
              <div class="docs-stat-label">Edited this week</div>
            </div>
            <div class="docs-stat-card">
              <div class="docs-stat-value" id="statCreatedMonth">—</div>
              <div class="docs-stat-label">Created this month</div>
            </div>
            <div class="docs-stat-card">
              <div class="docs-stat-value" id="statStorage">—</div>
              <div class="docs-stat-label" id="statStorageLabel">Storage used</div>
            </div>
          </div>

          <!-- Filters -->
          <div class="docs-filters">
            <div class="docs-search-wrap">
              <svg class="docs-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="#9ca3af" stroke-width="1.5"/>
                <path d="M10.5 10.5L13 13" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <input class="docs-search-input" id="searchInput" type="text" placeholder="Search documents and tags…" value="${escHtml(searchQuery)}"/>
            </div>
            <div class="docs-filter-group">
              <label class="docs-filter-label">From</label>
              <input class="docs-filter-date" id="filterFrom" type="date" value="${filterFrom}"/>
            </div>
            <div class="docs-filter-group">
              <label class="docs-filter-label">To</label>
              <input class="docs-filter-date" id="filterTo" type="date" value="${filterTo}"/>
            </div>
            <div class="docs-filter-group">
              <label class="docs-filter-label">Sort</label>
              <select class="docs-filter-select" id="sortSelect">
                <option value="updated_at:desc"  ${sortBy==="updated_at"  && sortDir==="desc" ? "selected":""}>Recently edited</option>
                <option value="updated_at:asc"   ${sortBy==="updated_at"  && sortDir==="asc"  ? "selected":""}>Oldest edited</option>
                <option value="created_at:desc"  ${sortBy==="created_at"  && sortDir==="desc" ? "selected":""}>Newest created</option>
                <option value="created_at:asc"   ${sortBy==="created_at"  && sortDir==="asc"  ? "selected":""}>Oldest created</option>
                <option value="title:asc"        ${sortBy==="title"       && sortDir==="asc"  ? "selected":""}>Title A→Z</option>
                <option value="title:desc"       ${sortBy==="title"       && sortDir==="desc" ? "selected":""}>Title Z→A</option>
                <option value="word_count:desc"  ${sortBy==="word_count"  && sortDir==="desc" ? "selected":""}>Longest first</option>
                <option value="word_count:asc"   ${sortBy==="word_count"  && sortDir==="asc"  ? "selected":""}>Shortest first</option>
              </select>
            </div>
            <button class="docs-filter-clear" id="clearFilters" title="Clear all filters">✕ Clear</button>
          </div>

          <!-- Active tag filters -->
          <div id="activeTagFilters"></div>

          <!-- Bulk action bar -->
          <div class="docs-bulk-bar" id="bulkBar" style="display:none">
            <span class="docs-bulk-count" id="bulkCount">0 selected</span>
            <div class="docs-bulk-actions">
              <button class="docs-bulk-btn docs-bulk-btn--coll" id="bulkAddCollBtn">⊕ Add to collection</button>
              <button class="docs-bulk-btn docs-bulk-btn--export" id="bulkExportBtn">↓ Export JSON</button>
              <button class="docs-bulk-btn docs-bulk-btn--delete" id="bulkDeleteBtn">🗑 Delete selected</button>
              <button class="docs-bulk-btn" id="bulkClearBtn">Deselect all</button>
            </div>
          </div>

          <!-- Select-all row -->
          <div class="docs-select-row" id="selectAllRow" style="display:none">
            <label class="docs-select-all-label">
              <input type="checkbox" id="selectAllChk"/>
              Select all visible
            </label>
          </div>

          <!-- Grid -->
          <div class="docs-grid" id="docsGrid"></div>

          <!-- Drop zone -->
          <div id="importDropZone" class="docs-drop-zone" style="display:none">
            <div class="docs-drop-zone-inner">
              <div class="docs-drop-icon">📄</div>
              <div class="docs-drop-label">Drop a .docx or .pdf file here</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  renderSidebar();
  wireEvents();
  renderGrid();
  loadStats();
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById("docsGrid");
  if (!grid) return;
  const visible = applyFilters(allDocs);

  // Update stats for the current view
  renderStats(visible);

  // Subtitle
  const sub = document.getElementById("docsSubtitle");
  if (sub) {
    const viewLabel = activeView === "all" ? "" : activeView === "uncategorized" ? "Uncategorized"
      : (allCollections.find(c => c.id === activeView)?.name ?? "");
    const countStr = `${visible.length}${allDocs.length !== visible.length ? ` of ${allDocs.length}` : ""} document${allDocs.length !== 1 ? "s" : ""}`;
    sub.textContent = viewLabel ? `${countStr} — ${viewLabel}` : countStr;
  }

  const selectRow = document.getElementById("selectAllRow");
  if (selectRow) selectRow.style.display = visible.length ? "flex" : "none";

  renderActiveTagFilters();

  if (!visible.length) {
    grid.innerHTML = `
      <div class="docs-empty">
        <div class="docs-empty-icon">📄</div>
        <div class="docs-empty-title">${allDocs.length ? "No documents match your filters" : "No documents yet"}</div>
        <div class="docs-empty-sub">${allDocs.length ? "Try clearing the filters." : "Click <strong>New document</strong> to get started."}</div>
      </div>`;
    updateBulkBar();
    return;
  }

  grid.innerHTML = visible.map(renderCard).join("");

  // Sync checkboxes
  grid.querySelectorAll(".docs-card-checkbox").forEach(chk => {
    chk.checked = selectedIds.has(chk.dataset.id);
  });

  // Tag click → filter
  grid.querySelectorAll(".docs-tag--clickable").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const tag = btn.dataset.tag;
      activeTagFilter = activeTagFilter.includes(tag)
        ? activeTagFilter.filter(t => t !== tag)
        : [...activeTagFilter, tag];
      renderGrid();
    });
  });

  // Per-card add-to-collection button
  grid.querySelectorAll(".docs-card-coll-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      // Select just this doc then open the modal
      const id = btn.dataset.id;
      const wasSelected = selectedIds.has(id);
      if (!wasSelected) selectedIds.add(id);
      openAddToCollectionModal();
      // After modal closes, restore selection state if it wasn't already selected
      if (!wasSelected) {
        const observer = new MutationObserver(() => {
          if (!document.getElementById("addCollModal")) {
            if (!selectedIds.has(id) || selectedIds.size === 1) selectedIds.delete(id);
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true });
      }
    });
  });

  // Edit-tags button
  grid.querySelectorAll(".docs-card-tags-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); openTagModal(btn.dataset.id); });
  });

  updateBulkBar();
}

function renderActiveTagFilters() {
  const el = document.getElementById("activeTagFilters");
  if (!el) return;
  if (!activeTagFilter.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="docs-active-tags">
      <span class="docs-active-tags-label">Tags:</span>
      ${activeTagFilter.map(t => {
        const { bg, fg } = tagColors(t);
        return `<span class="docs-active-tag" style="background:${bg};color:${fg}">${escHtml(t)}<button class="docs-active-tag-remove" data-remove-tag="${escHtml(t)}">×</button></span>`;
      }).join("")}
      <button class="docs-active-tags-clear">Clear tags</button>
    </div>`;
  el.querySelectorAll("[data-remove-tag]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTagFilter = activeTagFilter.filter(t => t !== btn.dataset.removeTag);
      renderGrid();
    });
  });
  el.querySelector(".docs-active-tags-clear")?.addEventListener("click", () => {
    activeTagFilter = [];
    renderGrid();
  });
}

function renderCard(doc) {
  const bg         = titleColor(doc.title || "?");
  const fg         = titleTextColor(doc.title || "?");
  const init       = initials(doc.title);
  const isSelected = selectedIds.has(doc.id);
  const words      = doc.word_count ? `${doc.word_count.toLocaleString()} words` : null;
  const vers       = doc.version_count ? `${doc.version_count}v` : null;
  const tags       = doc.tags || [];

  const collDots = (doc.collection_ids || []).map(cid => {
    const c = allCollections.find(x => x.id === cid);
    return c ? `<span class="docs-card-coll-dot" style="background:${c.color}" title="${escHtml(c.name)}"></span>` : "";
  }).join("");

  return `
    <div class="docs-card ${isSelected ? "docs-card--selected" : ""}" data-id="${doc.id}" data-title="${escHtml(doc.title || "Untitled")}">
      <label class="docs-card-checkbox-wrap" title="Select">
        <input type="checkbox" class="docs-card-checkbox" data-id="${doc.id}" ${isSelected ? "checked" : ""}/>
      </label>
      <div class="docs-card-thumb" style="background:${bg}; color:${fg}">${init}</div>
      <div class="docs-card-body">
        <div class="docs-card-title-row">
          <div class="docs-card-title">${escHtml(doc.title) || "<em>Untitled</em>"}</div>
          ${collDots ? `<div class="docs-card-coll-dots">${collDots}</div>` : ""}
        </div>
        <div class="docs-card-meta">
          <span class="docs-card-time" title="Last edited">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M6 3.5V6l1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            ${relativeTime(doc.updated_at)}
          </span>
          <span title="Created">${fmtDate(doc.created_at)}</span>
          ${words ? `<span title="Word count">✎ ${words}</span>` : ""}
          ${vers  ? `<span class="docs-card-versions" title="Saved versions">🕓 ${vers}</span>` : ""}
        </div>
        ${tags.length ? `<div class="docs-card-tags">${renderTagChips(tags, { clickable: true })}</div>` : ""}
      </div>
      <div class="docs-card-actions">
        <button class="docs-card-coll-btn" data-id="${doc.id}" title="Add to collection">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z" stroke="currentColor" stroke-width="1.3"/>
            <path d="M7 6.5v3M5.5 8h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="docs-card-tags-btn" data-id="${doc.id}" title="Edit tags">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 7.5L7 2h5v5L6.5 12.5 1.5 7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <circle cx="9.5" cy="4.5" r="1" fill="currentColor"/>
          </svg>
        </button>
        <button class="docs-card-edit" data-id="${doc.id}" title="Open in editor">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="docs-card-delete" data-id="${doc.id}" data-title="${escHtml(doc.title || "Untitled")}" title="Delete document">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ── Bulk bar ──────────────────────────────────────────────────────────────────

function updateBulkBar() {
  const bar   = document.getElementById("bulkBar");
  const count = document.getElementById("bulkCount");
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.style.display = "flex";
    count.textContent = `${selectedIds.size} selected`;
  } else {
    bar.style.display = "none";
  }
  const chk     = document.getElementById("selectAllChk");
  const visible = applyFilters(allDocs);
  if (chk) chk.checked = visible.length > 0 && visible.every(d => selectedIds.has(d.id));
}

// ── Events ────────────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById("newDocBtn").onclick = newDocument;

  document.getElementById("importDocxBtn").addEventListener("click", () => {
    document.getElementById("docxFileInput").click();
  });
  document.getElementById("docxFileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importDocxFile(file);
    e.target.value = "";
  });

  document.getElementById("importPdfBtn").addEventListener("click", () => {
    document.getElementById("pdfFileInput").click();
  });
  document.getElementById("pdfFileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importPdfFile(file);
    e.target.value = "";
  });

  setupDragDrop();

  document.getElementById("searchInput").addEventListener("input", e => {
    searchQuery = e.target.value;
    renderGrid();
  });
  document.getElementById("filterFrom").addEventListener("change", e => {
    filterFrom = e.target.value; renderGrid();
  });
  document.getElementById("filterTo").addEventListener("change", e => {
    filterTo = e.target.value; renderGrid();
  });
  document.getElementById("sortSelect").addEventListener("change", e => {
    [sortBy, sortDir] = e.target.value.split(":");
    renderGrid();
  });
  document.getElementById("clearFilters").addEventListener("click", () => {
    searchQuery = ""; filterFrom = ""; filterTo = "";
    sortBy = "updated_at"; sortDir = "desc";
    activeTagFilter = [];
    document.getElementById("searchInput").value = "";
    document.getElementById("filterFrom").value  = "";
    document.getElementById("filterTo").value    = "";
    document.getElementById("sortSelect").value  = "updated_at:desc";
    renderGrid();
  });

  const grid = document.getElementById("docsGrid");

  grid.addEventListener("change", e => {
    const chk = e.target.closest(".docs-card-checkbox");
    if (!chk) return;
    const id = chk.dataset.id;
    if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
    chk.closest(".docs-card")?.classList.toggle("docs-card--selected", chk.checked);
    updateBulkBar();
  });

  grid.addEventListener("click", e => {
    if (e.target.closest(".docs-card-checkbox-wrap, .docs-card-edit, .docs-card-delete, .docs-card-tags-btn, .docs-card-coll-btn, .docs-tag--clickable")) return;
    const card = e.target.closest(".docs-card[data-id]");
    if (card) readDoc(card.dataset.id);
  });

  grid.addEventListener("click", e => {
    const btn = e.target.closest(".docs-card-edit");
    if (!btn) return;
    e.stopPropagation();
    openDoc(btn.dataset.id);
  });

  grid.addEventListener("click", async e => {
    const btn = e.target.closest(".docs-card-delete");
    if (!btn) return;
    e.stopPropagation();
    const { id, title } = btn.dataset;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await fetch(`${API}/${id}`, { method: "DELETE" });
    selectedIds.delete(id);
    await reload();
  });

  document.getElementById("selectAllChk")?.addEventListener("change", e => {
    const visible = applyFilters(allDocs);
    if (e.target.checked) visible.forEach(d => selectedIds.add(d.id));
    else                   visible.forEach(d => selectedIds.delete(d.id));
    renderGrid();
  });

  document.getElementById("bulkDeleteBtn")?.addEventListener("click", bulkDelete);
  document.getElementById("bulkExportBtn")?.addEventListener("click", bulkExport);
  document.getElementById("bulkAddCollBtn")?.addEventListener("click", openAddToCollectionModal);
  document.getElementById("bulkClearBtn")?.addEventListener("click", () => {
    selectedIds.clear(); renderGrid();
  });
}

// ── Bulk operations ───────────────────────────────────────────────────────────

async function bulkDelete() {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} document${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
  const ids = [...selectedIds];
  await Promise.all(ids.map(id => fetch(`${API}/${id}`, { method: "DELETE" })));
  ids.forEach(id => selectedIds.delete(id));
  await reload();
  showImportToast(`Deleted ${ids.length} document${ids.length > 1 ? "s" : ""} ✓`, "success");
}

async function bulkExport() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  showImportToast("Preparing export…", "info");
  const docs = await Promise.all(ids.map(id => fetch(`${API}/${id}`).then(r => r.json())));
  const blob = new Blob([JSON.stringify(docs, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `documents-export-${new Date().toISOString().slice(0,10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
  showImportToast(`Exported ${docs.length} document${docs.length > 1 ? "s" : ""} ✓`, "success");
}

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(id, html) {
  document.getElementById(id)?.remove();
  const overlay = document.createElement("div");
  overlay.id = id;
  overlay.className = "docs-modal-overlay";
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function closeModal(id) { document.getElementById(id)?.remove(); }

// Collection create / edit
function openCollectionModal(collId) {
  const existing = collId ? allCollections.find(c => c.id === collId) : null;
  const curColor  = existing?.color ?? COLL_COLORS[0];

  openModal("collModal", `
    <div class="docs-modal">
      <div class="docs-modal-header">
        <span class="docs-modal-title">${existing ? "Edit collection" : "New collection"}</span>
        <button class="docs-modal-close" id="collModalClose">×</button>
      </div>
      <div class="docs-modal-body">
        <label class="docs-modal-label">Name</label>
        <input class="docs-modal-input" id="collNameInput" type="text" value="${escHtml(existing?.name ?? "")}" placeholder="e.g. Lummus Deal" autofocus/>
        <label class="docs-modal-label" style="margin-top:14px">Color</label>
        <div class="docs-color-swatches" id="colorSwatches">
          ${COLL_COLORS.map(c => `
            <button class="docs-color-swatch ${c === curColor ? "docs-color-swatch--active" : ""}" data-color="${c}" style="background:${c}"></button>
          `).join("")}
        </div>
      </div>
      <div class="docs-modal-footer">
        <button class="docs-modal-btn docs-modal-btn--secondary" id="collCancelBtn">Cancel</button>
        <button class="docs-modal-btn docs-modal-btn--primary" id="collSaveBtn">${existing ? "Save" : "Create"}</button>
      </div>
    </div>
  `);

  document.getElementById("collModalClose").onclick  = () => closeModal("collModal");
  document.getElementById("collCancelBtn").onclick   = () => closeModal("collModal");

  let selectedColor = curColor;
  document.querySelectorAll(".docs-color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      selectedColor = sw.dataset.color;
      document.querySelectorAll(".docs-color-swatch").forEach(s => s.classList.remove("docs-color-swatch--active"));
      sw.classList.add("docs-color-swatch--active");
    });
  });

  const save = async () => {
    const name = document.getElementById("collNameInput").value.trim();
    if (!name) { document.getElementById("collNameInput").focus(); return; }
    if (existing) {
      await fetch(`${COLL_API}/${existing.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: selectedColor }),
      });
    } else {
      const res = await fetch(COLL_API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: selectedColor }),
      });
      const coll = await res.json();
      // If docs are selected, auto-add them
      if (selectedIds.size) {
        await fetch(`${COLL_API}/${coll.id}/docs`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc_ids: [...selectedIds] }),
        });
      }
    }
    closeModal("collModal");
    await reload();
  };

  document.getElementById("collSaveBtn").addEventListener("click", save);
  document.getElementById("collNameInput").addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}

// Tag edit modal
function openTagModal(docId) {
  const doc = allDocs.find(d => d.id === docId);
  if (!doc) return;
  let currentTags = [...(doc.tags || [])];

  function updateChips() {
    const wrap = document.getElementById("tagChipsWrap");
    if (!wrap) return;
    wrap.innerHTML = currentTags.length
      ? renderTagChips(currentTags, { removable: true })
      : `<span class="docs-tags-empty">No tags yet</span>`;
    wrap.querySelectorAll("[data-remove-tag]").forEach(btn => {
      btn.addEventListener("click", () => {
        currentTags = currentTags.filter(t => t !== btn.dataset.removeTag);
        updateChips(); updateSuggestions();
      });
    });
  }

  function updateSuggestions() {
    const suggestWrap = document.getElementById("tagSuggestWrap");
    if (!suggestWrap) return;
    const suggestions = getAllUniqueTags().filter(t => !currentTags.includes(t)).slice(0, 10);
    suggestWrap.innerHTML = suggestions.map(t => {
      const { bg, fg } = tagColors(t);
      return `<button class="docs-tag docs-tag--suggestion" data-suggest="${escHtml(t)}" style="background:${bg};color:${fg}">${escHtml(t)}</button>`;
    }).join("");
    suggestWrap.querySelectorAll("[data-suggest]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!currentTags.includes(btn.dataset.suggest)) {
          currentTags = [...currentTags, btn.dataset.suggest];
          updateChips(); updateSuggestions();
        }
      });
    });
  }

  openModal("tagModal", `
    <div class="docs-modal">
      <div class="docs-modal-header">
        <span class="docs-modal-title">Edit tags</span>
        <button class="docs-modal-close" id="tagModalClose">×</button>
      </div>
      <div class="docs-modal-body">
        <div class="docs-tag-doc-name">${escHtml(doc.title || "Untitled")}</div>
        <div class="docs-tag-chips-edit" id="tagChipsWrap"></div>
        <div class="docs-tag-add-row">
          <input class="docs-modal-input" id="tagInput" type="text" placeholder="Add a tag…" autocomplete="off"/>
          <button class="docs-modal-btn docs-modal-btn--primary" id="tagAddBtn">Add</button>
        </div>
        <div class="docs-tag-suggestions" id="tagSuggestWrap"></div>
      </div>
      <div class="docs-modal-footer">
        <button class="docs-modal-btn docs-modal-btn--secondary" id="tagCancelBtn">Cancel</button>
        <button class="docs-modal-btn docs-modal-btn--primary" id="tagSaveBtn">Save tags</button>
      </div>
    </div>
  `);

  document.getElementById("tagModalClose").onclick = () => closeModal("tagModal");
  document.getElementById("tagCancelBtn").onclick  = () => closeModal("tagModal");

  const addTag = () => {
    const input = document.getElementById("tagInput");
    const val   = input?.value.trim().toLowerCase().replace(/\s+/g, "-");
    if (!val || currentTags.includes(val)) { if (input) input.value = ""; return; }
    currentTags = [...currentTags, val];
    input.value = "";
    updateChips(); updateSuggestions();
  };
  document.getElementById("tagAddBtn").addEventListener("click", addTag);
  document.getElementById("tagInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } });

  document.getElementById("tagSaveBtn").addEventListener("click", async () => {
    await fetch(`${API}/${docId}/tags`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: currentTags }),
    });
    const idx = allDocs.findIndex(d => d.id === docId);
    if (idx >= 0) allDocs[idx] = { ...allDocs[idx], tags: currentTags };
    closeModal("tagModal");
    renderGrid();
  });

  updateChips();
  updateSuggestions();
}

// Add to collection (bulk)
function openAddToCollectionModal() {
  if (!selectedIds.size) return;
  if (!allCollections.length) {
    showImportToast("Create a collection first.", "info");
    openCollectionModal(null);
    return;
  }

  openModal("addCollModal", `
    <div class="docs-modal">
      <div class="docs-modal-header">
        <span class="docs-modal-title">Add ${selectedIds.size} document${selectedIds.size > 1 ? "s" : ""} to…</span>
        <button class="docs-modal-close" id="addCollClose">×</button>
      </div>
      <div class="docs-modal-body">
        <div class="docs-coll-pick-list">
          ${allCollections.map(c => `
            <label class="docs-coll-pick-item">
              <input type="radio" name="pickColl" value="${c.id}"/>
              <svg class="docs-sidebar-coll-icon" width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M1.5 4a1 1 0 0 1 1-1h3.25l1.25 1.5H12.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4Z"
                  fill="${c.color}20" stroke="${c.color}" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
              <span class="docs-coll-pick-name">${escHtml(c.name)}</span>
              <span class="docs-coll-pick-count">${c.doc_count} docs</span>
            </label>
          `).join("")}
        </div>
      </div>
      <div class="docs-modal-footer">
        <button class="docs-modal-btn docs-modal-btn--secondary" id="addCollCancel">Cancel</button>
        <button class="docs-modal-btn docs-modal-btn--primary" id="addCollConfirm">Add to collection</button>
      </div>
    </div>
  `);

  document.getElementById("addCollClose").onclick  = () => closeModal("addCollModal");
  document.getElementById("addCollCancel").onclick = () => closeModal("addCollModal");

  document.getElementById("addCollConfirm").addEventListener("click", async () => {
    const collId = document.querySelector('input[name="pickColl"]:checked')?.value;
    if (!collId) return;
    await fetch(`${COLL_API}/${collId}/docs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_ids: [...selectedIds] }),
    });
    closeModal("addCollModal");
    const coll = allCollections.find(c => c.id === collId);
    await reload();
    showImportToast(`Added to "${coll?.name}" ✓`, "success");
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

function readDoc(id) { window.location.href = `/reader.html?id=${id}`; }
function openDoc(id) { window.location.href = `/?id=${id}`; }

async function newDocument() {
  const btn = document.getElementById("newDocBtn");
  btn.disabled = true; btn.textContent = "Creating…";
  const id    = randomId();
  const title = "Untitled document";
  const content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      { type: "paragraph", content: [] },
    ],
  };
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, content, title }) });

  // If a collection is currently selected, add the new doc to it automatically
  const collectionId = (activeView !== "all" && activeView !== "uncategorized") ? activeView : null;
  if (collectionId) {
    await fetch(`${COLL_API}/${collectionId}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_ids: [id] }),
    }).catch(() => {});
  }

  window.location.href = `/?id=${id}`;
}

// ── .docx import ──────────────────────────────────────────────────────────────

async function importDocxFile(file) {
  const btn = document.getElementById("importDocxBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }
  showImportToast("Parsing document…", "info");
  try {
    const docJson = await importDocx(file);
    const title   = extractDocTitle(docJson);
    const id      = randomId();
    const res = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: docJson, title }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const collId = (activeView !== "all" && activeView !== "uncategorized") ? activeView : null;
    if (collId) await fetch(`${COLL_API}/${collId}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_ids: [id] }) }).catch(() => {});
    showImportToast(`Imported "${title}" ✓`, "success");
    setTimeout(() => { window.location.href = `/?id=${id}`; }, 600);
  } catch (err) {
    showImportToast(`Import failed: ${err.message}`, "error");
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Import .docx`; }
  }
}

async function importPdfFile(file) {
  const btn = document.getElementById("importPdfBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }
  showImportToast("Loading PDF…", "info");
  try {
    const docJson = await importPdf(file, {
      onProgress: (cur, total) => {
        showImportToast(total > 1 ? `Extracting text: page ${cur} / ${total}…` : "Extracting text…", "info");
      },
      onOcr: (cur, total, pageNum) => {
        showImportToast(`OCR scanning page ${pageNum} (${cur} / ${total})…`, "info");
      },
    });

    const title = extractPdfTitle(docJson);
    const id    = randomId();
    const res   = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: docJson, title }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const collId = (activeView !== "all" && activeView !== "uncategorized") ? activeView : null;
    if (collId) await fetch(`${COLL_API}/${collId}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_ids: [id] }) }).catch(() => {});
    showImportToast(`Imported "${title}" ✓`, "success");
    setTimeout(() => { window.location.href = `/?id=${id}`; }, 800);
  } catch (err) {
    console.error("[importPdfFile] failed:", err);
    showImportToast(`Import failed: ${err.message || String(err)}`, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 12h10M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Import PDF`;
    }
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
    setTimeout(() => { t.classList.remove("docs-import-toast--visible"); setTimeout(() => t.remove(), 300); }, 3000);
  }
}

function setupDragDrop() {
  const dropZone = document.getElementById("importDropZone");
  if (!dropZone) return;
  let dragCounter = 0;
  document.addEventListener("dragenter", e => { dragCounter++; dropZone.style.display = "flex"; e.preventDefault(); });
  document.addEventListener("dragleave", () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropZone.style.display = "none"; } });
  document.addEventListener("dragover",  e => e.preventDefault());
  document.addEventListener("drop", e => {
    e.preventDefault(); dragCounter = 0; dropZone.style.display = "none";
    const files = [...(e.dataTransfer?.files || [])];
    const docx  = files.find(f => f.name.toLowerCase().endsWith(".docx"));
    const pdf   = files.find(f => f.name.toLowerCase().endsWith(".pdf"));
    if (docx) importDocxFile(docx);
    else if (pdf) importPdfFile(pdf);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    await Promise.all([loadDocs(), loadCollections()]);
    renderApp();
  } catch {
    renderApiError();
  }
}

function renderApiError() {
  document.getElementById("docs-app").innerHTML = `
    <div class="docs-layout">
      <header class="docs-header">
        <div class="docs-header-left">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="#6366f1"/>
            <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <h1 class="docs-title">Documents</h1>
        </div>
      </header>
      <div class="docs-api-error">
        <div class="docs-api-error-icon">⚠️</div>
        <div class="docs-api-error-title">API server is not running</div>
        <div class="docs-api-error-sub">
          Start it with <code>node server.js</code> then <a href="" onclick="location.reload();return false;">reload</a>.
        </div>
      </div>
    </div>`;
}

init();
