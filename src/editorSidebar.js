/**
 * editorSidebar.js
 * Mounts a lightweight navigation sidebar in the editor view.
 * Reuses the same .docs-sidebar-* CSS classes as docs.html.
 */

const escHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function folderIcon(color) {
  return `<svg class="docs-sidebar-coll-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 4a1 1 0 0 1 1-1h3.25l1.25 1.5H12.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4Z"
      fill="${color}20" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
}

export async function mountEditorSidebar(containerEl, currentDocId) {
  // Render skeleton immediately
  containerEl.innerHTML = `
    <div class="docs-sidebar-header">
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#6366f1"/>
        <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="docs-sidebar-brand">v${__APP_VERSION__}</span>
    </div>
    <nav class="docs-sidebar-nav">
      <div class="docs-sidebar-item" style="opacity:.4;pointer-events:none">Loading…</div>
    </nav>`;

  try {
    const [docsRes, collsRes] = await Promise.all([
      fetch("/api/docs?limit=300"),
      fetch("/api/collections"),
    ]);
    const docs  = docsRes.ok  ? await docsRes.json()  : [];
    const colls = collsRes.ok ? await collsRes.json() : [];

    // Recent docs — most recently edited, max 8
    const recent = [...docs]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 8);

    containerEl.innerHTML = `
      <div class="docs-sidebar-header">
        <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="7" fill="#6366f1"/>
          <path d="M8 8h12M8 13h12M8 18h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="docs-sidebar-brand">v${__APP_VERSION__}</span>
      </div>

      <nav class="docs-sidebar-nav">
        <!-- All documents -->
        <a class="docs-sidebar-item" href="/docs.html">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
            <rect x="8" y="1" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
            <rect x="1" y="8" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
            <rect x="8" y="8" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
          </svg>
          All Documents
          <span class="docs-sidebar-count">${docs.length}</span>
        </a>

        ${colls.length ? `
          <div class="docs-sidebar-divider"></div>
          <div class="docs-sidebar-section-label">Collections</div>
          ${colls.map(c => `
            <a class="docs-sidebar-coll-row" href="/docs.html?view=${encodeURIComponent(c.id)}">
              ${folderIcon(c.color)}
              <span class="docs-sidebar-coll-name">${escHtml(c.name)}</span>
              <span class="docs-sidebar-count">${c.doc_count ?? 0}</span>
            </a>
          `).join("")}
        ` : ""}

        ${recent.length ? `
          <div class="docs-sidebar-divider"></div>
          <div class="docs-sidebar-section-label">Recent</div>
          ${recent.map(d => `
            <a class="docs-sidebar-item ${d.id === currentDocId ? "docs-sidebar-item--active" : ""}"
               href="/index.html?id=${encodeURIComponent(d.id)}"
               title="${escHtml(d.title || "Untitled document")}">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M3 1h6l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z"
                  stroke="currentColor" stroke-width="1.3"/>
                <path d="M9 1v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
              <span class="es-doc-name">${escHtml(d.title || "Untitled document")}</span>
            </a>
          `).join("")}
        ` : ""}
      </nav>

      <div class="docs-sidebar-footer">
        <a class="docs-sidebar-footer-link" href="/extensions.html">Extensions</a>
        <a class="docs-sidebar-footer-link" href="/connectors.html">Connectors</a>
        <a class="docs-sidebar-footer-link" href="/audit.html">Audit</a>
      </div>`;
  } catch (e) {
    console.warn("Editor sidebar load failed", e);
  }
}
