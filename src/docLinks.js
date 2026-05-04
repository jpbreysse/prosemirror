/**
 * docLinks.js
 *
 * Renders and manages the "Related documents" section that appears below the
 * editor (main.js) and below the reader content (reader.js).
 *
 * Public API:
 *   mountDocLinksSection(containerEl, docId, { readOnly })
 *     – fetches links, renders the section, wires up add/remove interactions.
 *     – call again to refresh (re-mounts cleanly into the same container).
 */

import { openGraphModal } from "./docGraph.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const LINK_LABELS = {
  references:    'References',
  supersedes:    'Supersedes',
  superseded_by: 'Superseded by',
  implements:    'Implements',
  closes:        'Closes',
};

// link types the user can explicitly choose when adding a link.
// 'superseded_by' is excluded — it is only ever created as an automatic inverse.
const CREATABLE_LINK_TYPES = ['references', 'supersedes', 'implements', 'closes'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readerHref(docId) {
  return `/reader.html?id=${encodeURIComponent(docId)}`;
}

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'version-toast' + (isError ? ' version-toast--error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('version-toast--visible'), 10);
  setTimeout(() => {
    t.classList.remove('version-toast--visible');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

// ── Picker modal ──────────────────────────────────────────────────────────────

function openAddLinkModal(docId, excludeIds, onSuccess) {
  document.querySelector('.dl-picker-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'dl-picker-overlay';
  overlay.innerHTML = `
    <div class="dl-picker-modal">
      <div class="dl-picker-title">Add related document</div>

      <label class="dl-picker-label">Relationship</label>
      <select class="dl-picker-type" id="dlPickerType">
        ${CREATABLE_LINK_TYPES.map(t =>
          `<option value="${t}">${LINK_LABELS[t]}</option>`
        ).join('')}
      </select>

      <label class="dl-picker-label">Search documents</label>
      <input class="dl-picker-search" id="dlPickerSearch"
             placeholder="Type to search by title…" autocomplete="off" />

      <div class="dl-picker-results" id="dlPickerResults">
        <div class="dl-picker-hint">Start typing to find a document</div>
      </div>

      <div class="dl-picker-footer">
        <button class="dl-picker-cancel" id="dlPickerCancel">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const searchEl  = overlay.querySelector('#dlPickerSearch');
  const resultsEl = overlay.querySelector('#dlPickerResults');
  const typeEl    = overlay.querySelector('#dlPickerType');
  const cancelBtn = overlay.querySelector('#dlPickerCancel');

  let debounceTimer;

  function close() { overlay.remove(); }

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchEl.value.trim();
    if (!q) {
      resultsEl.innerHTML = '<div class="dl-picker-hint">Start typing to find a document</div>';
      return;
    }
    resultsEl.innerHTML = '<div class="dl-picker-hint">Searching…</div>';
    debounceTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/docs?search=${encodeURIComponent(q)}&limit=20`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const docs = await r.json();

        // exclude current doc and already-linked docs
        const exclude = new Set([docId, ...excludeIds]);
        const filtered = docs.filter(d => !exclude.has(d.id));

        if (!filtered.length) {
          resultsEl.innerHTML = '<div class="dl-picker-hint">No matching documents</div>';
          return;
        }

        resultsEl.innerHTML = filtered.map(d => `
          <div class="dl-picker-row" data-id="${esc(d.id)}" data-title="${esc(d.title || 'Untitled')}">
            <span class="dl-picker-row-title">${esc(d.title || 'Untitled')}</span>
            <span class="dl-picker-row-id">${esc(d.id.slice(0, 8))}…</span>
          </div>`).join('');

        resultsEl.querySelectorAll('.dl-picker-row').forEach(row => {
          row.addEventListener('click', async () => {
            const toDoc    = row.dataset.id;
            const toTitle  = row.dataset.title;
            const linkType = typeEl.value;

            // Optimistically close
            close();

            try {
              const r = await fetch(`/api/docs/${docId}/links`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ to_doc: toDoc, link_type: linkType, to_title: toTitle }),
              });
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                showToast(body.error || 'Failed to add link', true);
                return;
              }
              showToast('Link added');
              onSuccess();
            } catch (e) {
              showToast('Network error: ' + e.message, true);
            }
          });
        });
      } catch (e) {
        resultsEl.innerHTML = `<div class="dl-picker-hint">Error: ${esc(e.message)}</div>`;
      }
    }, 220);
  });

  setTimeout(() => searchEl.focus(), 30);
}

// ── Section renderer ──────────────────────────────────────────────────────────

async function render(containerEl, docId, readOnly, fromTitle) {
  let data;
  try {
    const r = await fetch(`/api/docs/${docId}/links`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    containerEl.innerHTML = `
      <div class="doc-links-section">
        <p class="dls-empty">Could not load related documents: ${esc(e.message)}</p>
      </div>`;
    return;
  }

  const { outgoing = [], incoming = [] } = data;
  const total = outgoing.length + incoming.length;

  // IDs already linked (for excluding from picker)
  const linkedIds = outgoing.map(l => l.to_doc);

  function renderRow(link, side) {
    const targetId    = side === 'out' ? link.to_doc    : link.from_doc;
    const targetTitle = side === 'out' ? (link.to_title || link.to_doc)
                                        : (link.from_title || link.from_doc);
    const label = LINK_LABELS[link.link_type] ?? link.link_type;

    const unlinkBtn = (!readOnly && side === 'out') ? `
      <button class="dls-unlink-btn" data-link-id="${esc(link.id)}"
              data-link-title="${esc(targetTitle)}" title="Remove link">
        unlink
      </button>` : '';

    return `
      <li class="dls-row">
        <span class="dls-badge">${esc(label)}</span>
        <a class="dls-link" href="${readerHref(targetId)}"
           title="${esc(targetTitle)}">${esc(targetTitle)}</a>
        ${unlinkBtn}
      </li>`;
  }

  const outHtml = outgoing.length ? `
    <div class="dls-group">
      <div class="dls-group-label">From this document</div>
      <ul class="dls-list">${outgoing.map(l => renderRow(l, 'out')).join('')}</ul>
    </div>` : '';

  const incHtml = incoming.length ? `
    <div class="dls-group">
      <div class="dls-group-label">Linked from other documents</div>
      <ul class="dls-list">${incoming.map(l => renderRow(l, 'in')).join('')}</ul>
    </div>` : '';

  const emptyHtml = (!outgoing.length && !incoming.length) ? `
    <p class="dls-empty">No related documents.${readOnly ? '' : ' Use "+ Add link" to connect this document to another.'}</p>` : '';

  const addBtn = readOnly ? '' : `
    <button class="dls-add-btn" id="dlsAddBtn">+ Add link</button>`;

  containerEl.innerHTML = `
    <div class="doc-links-section">
      <div class="dls-header">
        <span class="dls-title">Related documents <span class="dls-count">(${total})</span></span>
        <div class="dls-header-actions">
          <button class="dls-graph-btn" id="dlsGraphBtn" title="View knowledge graph">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <circle cx="3"  cy="8"  r="2"/>
              <circle cx="13" cy="3"  r="2"/>
              <circle cx="13" cy="13" r="2"/>
              <line x1="5"  y1="7.2" x2="11" y2="4"/>
              <line x1="5"  y1="8.8" x2="11" y2="12"/>
            </svg>
            Graph
          </button>
          ${addBtn}
        </div>
      </div>
      ${outHtml}
      ${incHtml}
      ${emptyHtml}
    </div>`;

  // Wire up "Graph" button (always visible)
  containerEl.querySelector('#dlsGraphBtn')?.addEventListener('click', () => {
    openGraphModal(docId, fromTitle);
  });

  // Wire up "+ Add link"
  if (!readOnly) {
    containerEl.querySelector('#dlsAddBtn')?.addEventListener('click', () => {
      openAddLinkModal(docId, linkedIds, () => render(containerEl, docId, readOnly, fromTitle));
    });
  }

  // Wire up unlink buttons
  containerEl.querySelectorAll('.dls-unlink-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const linkId    = btn.dataset.linkId;
      const linkTitle = btn.dataset.linkTitle;
      if (!confirm(`Remove link to "${linkTitle}"?`)) return;
      try {
        const r = await fetch(`/api/docs/${docId}/links/${linkId}`, { method: 'DELETE' });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          showToast(body.error || 'Failed to remove link', true);
          return;
        }
        showToast('Link removed');
        render(containerEl, docId, readOnly, fromTitle);
      } catch (e) {
        showToast('Network error: ' + e.message, true);
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount (or refresh) the "Related documents" section in containerEl.
 *
 * @param {HTMLElement} containerEl   - Element to render into (replaced on refresh)
 * @param {string}      docId         - ID of the current document
 * @param {object}      [opts]
 * @param {boolean}     [opts.readOnly=false]  - Hide add/unlink controls
 * @param {string}      [opts.fromTitle='']    - Title of the current doc (for inverse label)
 */
export async function mountDocLinksSection(containerEl, docId, { readOnly = false, fromTitle = '' } = {}) {
  await render(containerEl, docId, readOnly, fromTitle);
}
