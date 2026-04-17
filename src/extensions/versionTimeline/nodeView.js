/**
 * VersionTimelineNodeView
 *
 * An inline block that displays the version history of the current document
 * as a visual timeline. Users can save new versions, restore past ones,
 * diff between versions, or delete them directly from within the document.
 *
 * The block is self-contained: it derives the docId from the current URL at
 * render time, so it always shows the right document's history.
 */

import { extractLines, diffLines, diffStats } from "../../utils/diff.js";

export class VersionTimelineNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "vtl-block";
    this._build();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _docId() {
    const raw = new URLSearchParams(window.location.search).get("id");
    return (raw && raw !== "undefined" && raw !== "null") ? raw : null;
  }

  _fmt(iso) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = `
      <div class="vtl-header">
        <span class="vtl-icon">🕓</span>
        <span class="vtl-title">Version Timeline</span>
        <div class="vtl-header-actions">
          <button class="vtl-save-btn">+ Save version</button>
          <button class="vtl-refresh-btn" title="Refresh">↺</button>
        </div>
      </div>
      <div class="vtl-body"></div>
    `;

    this.dom.querySelector(".vtl-refresh-btn").addEventListener("click", () => this._load());
    this.dom.querySelector(".vtl-save-btn").addEventListener("click",    () => this._promptSave());

    if (this._docId()) {
      this._load();
    } else {
      this._showEmpty("Save the document first to start tracking versions.", true);
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async _load() {
    const docId = this._docId();
    if (!docId) return;

    const body = this.dom.querySelector(".vtl-body");
    body.className = "vtl-body";
    body.innerHTML = `<div class="vtl-loading">Loading…</div>`;

    try {
      const r = await fetch(`/api/docs/${docId}/versions`);
      const versions = await r.json();

      if (!Array.isArray(versions) || !versions.length) {
        this._showEmpty("No versions saved yet. Click \"+ Save version\" above to snapshot the current document.");
        return;
      }

      this._renderTimeline(versions);
    } catch {
      body.innerHTML = `<div class="vtl-error">⚠ Could not load version history.</div>`;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _showEmpty(msg, noSave = false) {
    const body = this.dom.querySelector(".vtl-body");
    body.innerHTML = `
      <div class="vtl-empty">
        <div class="vtl-empty-icon">🕓</div>
        <div>${msg}</div>
      </div>`;
    if (noSave) {
      const btn = this.dom.querySelector(".vtl-save-btn");
      if (btn) btn.disabled = true;
    }
  }

  _renderTimeline(versions) {
    const body = this.dom.querySelector(".vtl-body");
    body.innerHTML = "";

    const tl = document.createElement("div");
    tl.className = "vtl-timeline";

    versions.forEach((v, i) => {
      const isLatest = i === 0;
      const item = document.createElement("div");
      item.className = "vtl-item" + (isLatest ? " vtl-item--latest" : "");

      item.innerHTML = `
        <div class="vtl-connector">
          <div class="vtl-dot${isLatest ? " vtl-dot--latest" : ""}"></div>
          ${i < versions.length - 1 ? '<div class="vtl-line"></div>' : ""}
        </div>
        <div class="vtl-content">
          <div class="vtl-item-top">
            <span class="vtl-vnum">v${v.version_num}</span>
            <span class="vtl-label">${this._esc(v.label || `Version ${v.version_num}`)}</span>
            ${isLatest ? '<span class="vtl-badge-latest">Latest</span>' : ""}
          </div>
          <div class="vtl-date">${this._fmt(v.created_at)}</div>
          <div class="vtl-actions">
            <button class="vtl-diff-btn"    data-vidx="${i}" title="Compare with ${i === 0 ? "current document" : `v${versions[i - 1].version_num}`}">↔ Diff</button>
            <button class="vtl-restore-btn" data-vid="${v.id}" data-vnum="${v.version_num}">↩ Restore</button>
            <button class="vtl-delete-btn"  data-vid="${v.id}" title="Delete version">🗑</button>
          </div>
        </div>`;

      item.querySelector(".vtl-diff-btn").addEventListener("click", () =>
        this._openDiff(versions, i)
      );
      item.querySelector(".vtl-restore-btn").addEventListener("click", () =>
        this._restore(v.id, v.version_num)
      );
      item.querySelector(".vtl-delete-btn").addEventListener("click", () =>
        this._deleteVersion(v.id)
      );

      tl.appendChild(item);
    });

    body.appendChild(tl);
  }

  _esc(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _promptSave() {
    const docId = this._docId();
    if (!docId) return;

    const label = prompt("Version label (optional, press Enter to skip):", "");
    if (label === null) return; // user cancelled

    const btn = this.dom.querySelector(".vtl-save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      const r = await fetch(`/api/docs/${docId}/versions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label: label.trim() }),
      });
      if (r.ok) {
        btn.textContent = "✓ Saved!";
        setTimeout(() => {
          btn.textContent = "+ Save version";
          btn.disabled = false;
        }, 1500);
        this._load();
      } else {
        throw new Error();
      }
    } catch {
      btn.textContent = "+ Save version";
      btn.disabled = false;
      alert("Could not save version.");
    }
  }

  async _openDiff(versions, idx) {
    const docId = this._docId();
    if (!docId) return;

    const older      = versions[idx];
    const olderLabel = older.label || `v${older.version_num}`;

    try {
      const olderR    = await fetch(`/api/docs/${docId}/versions/${older.id}`);
      const olderFull = await olderR.json();
      const linesOld  = extractLines(olderFull.content);

      let linesNew, newerLabel;
      if (idx === 0) {
        linesNew    = extractLines(window.__editorView?.state.doc.toJSON());
        newerLabel  = "Current document";
      } else {
        const newer      = versions[idx - 1];
        const newerR     = await fetch(`/api/docs/${docId}/versions/${newer.id}`);
        const newerFull  = await newerR.json();
        linesNew    = extractLines(newerFull.content);
        newerLabel  = newer.label || `v${newer.version_num}`;
      }

      this._renderDiffModal(olderLabel, linesOld, newerLabel, linesNew);
    } catch {
      alert("Could not load version content for diff.");
    }
  }

  _renderDiffModal(labelOld, linesOld, labelNew, linesNew) {
    document.querySelector(".diff-modal-overlay")?.remove();

    const ops   = diffLines(linesOld, linesNew);
    const stats = diffStats(ops);
    const noChanges = stats.added === 0 && stats.removed === 0;

    const diffHTML = ops.map(op => {
      const cls    = op.op === "insert" ? "diff-line--insert"
                   : op.op === "delete" ? "diff-line--delete"
                   : "diff-line--equal";
      const prefix = op.op === "insert" ? "+" : op.op === "delete" ? "−" : " ";
      const text   = op.value.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="diff-line ${cls}"><span class="diff-line-prefix">${prefix}</span>${text}</div>`;
    }).join("");

    const overlay = document.createElement("div");
    overlay.className = "diff-modal-overlay";
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
          <button class="diff-close-btn">✕</button>
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

  async _restore(versionId, vnum) {
    const docId = this._docId();
    if (!docId) return;
    if (!confirm(`Restore to v${vnum}?\n\nThe current document will be overwritten. Tip: save your current state as a version first.`)) return;

    try {
      const r  = await fetch(`/api/docs/${docId}/versions/${versionId}`);
      const v  = await r.json();
      await fetch(`/api/docs/${docId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ content: v.content }),
      });
      setTimeout(() => window.location.reload(), 300);
    } catch {
      alert("Could not restore version.");
    }
  }

  async _deleteVersion(versionId) {
    const docId = this._docId();
    if (!docId) return;
    if (!confirm("Delete this version? This cannot be undone.")) return;

    await fetch(`/api/docs/${docId}/versions/${versionId}`, { method: "DELETE" });
    this._load();
  }

  // ── ProseMirror NodeView interface ────────────────────────────────────────

  update(node) {
    this.node = node;
    return true;
  }

  stopEvent()      { return true; }
  ignoreMutation() { return true; }
}
