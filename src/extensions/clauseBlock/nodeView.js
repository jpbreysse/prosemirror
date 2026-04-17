/**
 * ClauseBlockNodeView
 *
 * A live block connected to the Lex clause library API (via /api/lex proxy).
 *
 * States:
 *   search  — unconfigured: search box + category filter to find a clause
 *   loading — fetching from API
 *   loaded  — shows clause card with text, metadata and action buttons
 *   error   — API unreachable or clause not found
 *
 * Edit mode: click "📝 Edit text" to open inline overlay → PATCH back on Save.
 * Replace:   shows search UI again to swap for a different clause.
 * Unlink:    resets to search state (removes clauseId from attrs).
 * Read-only: hides all edit/replace/unlink controls.
 */

// ── Color maps ────────────────────────────────────────────────────────────────

const RISK_COLORS = {
  low:      { bg: "#dcfce7", text: "#166534", border: "#22c55e", dot: "#22c55e" },
  medium:   { bg: "#fef9c3", text: "#854d0e", border: "#f59e0b", dot: "#f59e0b" },
  high:     { bg: "#ffedd5", text: "#9a3412", border: "#f97316", dot: "#f97316" },
  critical: { bg: "#fee2e2", text: "#991b1b", border: "#ef4444", dot: "#ef4444" },
};

const CATEGORY_COLORS = {
  liability:       { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  indemnity:       { bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
  confidentiality: { bg: "#ecfeff", text: "#0e7490", border: "#a5f3fc" },
  payment:         { bg: "#f0fdf4", text: "#065f46", border: "#a7f3d0" },
  termination:     { bg: "#fff1f2", text: "#be123c", border: "#fecdd3" },
  IP:              { bg: "#fefce8", text: "#a16207", border: "#fde68a" },
  dispute:         { bg: "#eef2ff", text: "#4338ca", border: "#c7d2fe" },
  warranty:        { bg: "#f0fdfa", text: "#0f766e", border: "#99f6e4" },
  data_protection: { bg: "#fdf4ff", text: "#a21caf", border: "#f0abfc" },
  general:         { bg: "#f9fafb", text: "#374151", border: "#e5e7eb" },
};

const CATEGORIES = [
  "all", "liability", "indemnity", "confidentiality", "payment",
  "termination", "IP", "dispute", "warranty", "data_protection", "general",
];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class ClauseBlockNodeView {
  constructor(node, view, getPos) {
    this.node     = node;
    this.view     = view;
    this.getPos   = getPos;
    this._expanded = false;

    this.dom = document.createElement("div");
    this.dom.className = "clb-block";
    this._build();
  }

  // ── Patch helper ──────────────────────────────────────────────────────────

  _patch(changes) {
    const { state, dispatch } = this.view;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...changes }));
  }

  get _readonly() { return this.view.props.editable?.() === false; }

  // ── API helper ────────────────────────────────────────────────────────────

  async _apiFetch(path, opts = {}) {
    const res = await fetch(`/api/lex${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok && res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Load clause ───────────────────────────────────────────────────────────

  async _loadClause(id) {
    this._patch({ status: "loading", clauseId: id });
    try {
      const clause = await this._apiFetch(`/clauses/${id}`);
      this._patch({
        clauseId: clause.id,
        data:     clause,
        status:   "loaded",
        error:    "",
      });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  // ── Build dispatcher ──────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    const { clauseId, status, error } = this.node.attrs;

    if (status === "search" || !clauseId) {
      this._buildSearch();
    } else if (status === "loading") {
      this._buildLoading();
    } else if (status === "error") {
      this._buildError(error);
    } else {
      this._buildCard();
    }
  }

  // ── Search state ──────────────────────────────────────────────────────────

  _buildSearch() {
    const wrap = document.createElement("div");
    wrap.className = "clb-search";

    const header = document.createElement("div");
    header.className = "clb-search-header";
    header.innerHTML = `<span class="clb-search-icon">📋</span>
      <span class="clb-search-title">Link Clause</span>`;

    const controls = document.createElement("div");
    controls.className = "clb-search-controls";

    const input = document.createElement("input");
    input.className = "clb-search-input";
    input.placeholder = "Search clauses by title or keyword…";

    const catSelect = document.createElement("select");
    catSelect.className = "clb-search-cat";
    CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c === "all" ? "All categories" : c.replace("_", " ");
      catSelect.appendChild(opt);
    });

    controls.append(input, catSelect);

    const results = document.createElement("div");
    results.className = "clb-search-results";

    let debounce;
    const doSearch = () => {
      clearTimeout(debounce);
      const q   = input.value.trim();
      const cat = catSelect.value;
      if (q.length < 2) { results.innerHTML = ""; return; }
      debounce = setTimeout(() => this._doSearch(q, cat, results), 300);
    };

    input.addEventListener("input", doSearch);
    catSelect.addEventListener("change", doSearch);

    wrap.append(header, controls, results);
    this.dom.appendChild(wrap);
    if (!this._readonly) setTimeout(() => input.focus(), 50);
  }

  async _doSearch(q, category, results) {
    results.innerHTML = `<div class="clb-search-spinner">Searching…</div>`;
    try {
      const params = new URLSearchParams({ search: q, limit: "8" });
      if (category && category !== "all") params.set("category", category);
      const res = await this._apiFetch(`/clauses?${params}`);
      const list = res.data || res;
      if (!list.length) {
        results.innerHTML = `<div class="clb-search-empty">No clauses found for "${q}"</div>`;
        return;
      }
      results.innerHTML = "";
      list.forEach(c => {
        const row = document.createElement("div");
        row.className = "clb-search-row";
        const rc = RISK_COLORS[c.risk_level]    || RISK_COLORS.medium;
        const cc = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.general;
        row.innerHTML = `
          <div class="clb-search-row-main">
            <span class="clb-search-row-title">${c.title}</span>
            <span class="clb-search-row-meta">${c.jurisdiction || ""}${c.jurisdiction && c.category ? " · " : ""}${c.category || ""}</span>
          </div>
          <div class="clb-search-row-badges">
            <span class="clb-badge" style="background:${cc.bg};color:${cc.text};border-color:${cc.border}">${c.category || "general"}</span>
            <span class="clb-badge" style="background:${rc.bg};color:${rc.text};border-color:${rc.border}">${c.risk_level || "medium"}</span>
          </div>`;
        row.addEventListener("click", () => this._loadClause(c.id));
        results.appendChild(row);
      });
    } catch {
      results.innerHTML = `<div class="clb-search-empty">Could not reach Lex API — is the server running?</div>`;
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  _buildLoading() {
    const el = document.createElement("div");
    el.className = "clb-loading";
    el.innerHTML = `<span class="clb-spinner"></span> Loading clause…`;
    this.dom.appendChild(el);
  }

  // ── Error state ───────────────────────────────────────────────────────────

  _buildError(msg) {
    const el = document.createElement("div");
    el.className = "clb-error";
    el.innerHTML = `
      <span>⚠️ ${msg || "Could not load clause"}</span>
      <button class="clb-error-retry">Retry</button>
      <button class="clb-error-unlink">Unlink</button>`;
    el.querySelector(".clb-error-retry").addEventListener("click", () =>
      this._loadClause(this.node.attrs.clauseId));
    el.querySelector(".clb-error-unlink").addEventListener("click", () =>
      this._patch({ clauseId: "", data: null, status: "search", error: "" }));
    this.dom.appendChild(el);
  }

  // ── Loaded card ───────────────────────────────────────────────────────────

  _buildCard() {
    const { data } = this.node.attrs;
    if (!data) { this._buildSearch(); return; }

    const rc = RISK_COLORS[data.risk_level]    || RISK_COLORS.medium;
    const cc = CATEGORY_COLORS[data.category] || CATEGORY_COLORS.general;

    // ── Header row ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "clb-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "clb-header-left";
    headerLeft.innerHTML = `<span class="clb-icon">📋</span>
      <span class="clb-badge" style="background:${cc.bg};color:${cc.text};border-color:${cc.border}">${data.category || "general"}</span>
      <span class="clb-badge clb-badge--risk" style="background:${rc.bg};color:${rc.text};border-color:${rc.border}">
        <span class="clb-badge-dot" style="background:${rc.dot}"></span>${data.risk_level || "medium"}
      </span>
      ${data._localEdit ? `<span class="clb-badge clb-badge--local" title="This text differs from the shared library">✏ Local edit</span>` : ""}`;

    header.appendChild(headerLeft);
    this.dom.appendChild(header);

    // ── Title + meta ─────────────────────────────────────────────────────────
    const titleEl = document.createElement("div");
    titleEl.className = "clb-title";
    titleEl.textContent = data.title || "Untitled Clause";
    this.dom.appendChild(titleEl);

    const metaEl = document.createElement("div");
    metaEl.className = "clb-meta";
    const metaParts = [];
    if (data.jurisdiction) metaParts.push(data.jurisdiction);
    if (data.version)      metaParts.push(`v${data.version}`);
    if (data.last_reviewed_at) {
      const d = new Date(data.last_reviewed_at);
      metaParts.push(`Last reviewed: ${d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`);
    }
    metaEl.textContent = metaParts.join(" · ");
    this.dom.appendChild(metaEl);

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Clause text ──────────────────────────────────────────────────────────
    const textWrap = document.createElement("div");
    textWrap.className = "clb-text-wrap";

    const textEl = document.createElement("div");
    textEl.className = "clb-text" + (this._expanded ? " clb-text--expanded" : "");
    textEl.textContent = data.text || "";
    textWrap.appendChild(textEl);

    const lineCount = (data.text || "").split("\n").length;
    const approxLines = Math.ceil((data.text || "").length / 80) + lineCount;
    if (approxLines > 6) {
      const toggle = document.createElement("button");
      toggle.className = "clb-expand-btn";
      toggle.textContent = this._expanded ? "▲ Collapse" : "▼ Show more";
      toggle.addEventListener("click", () => {
        this._expanded = !this._expanded;
        this._build();
      });
      textWrap.appendChild(toggle);
    }
    this.dom.appendChild(textWrap);

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (data.tags && data.tags.length) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "clb-tags";
      const tagsLabel = document.createElement("span");
      tagsLabel.className = "clb-tags-label";
      tagsLabel.textContent = "Tags:";
      tagsWrap.appendChild(tagsLabel);
      (data.tags || []).forEach(tag => {
        const t = document.createElement("span");
        t.className = "clb-tag";
        t.textContent = tag;
        tagsWrap.appendChild(t);
      });
      this.dom.appendChild(tagsWrap);
    }

    // ── Action bar ────────────────────────────────────────────────────────────
    if (!this._readonly) {
      const actions = document.createElement("div");
      actions.className = "clb-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "clb-action-btn";
      editBtn.textContent = "📝 Edit text";
      editBtn.addEventListener("click", () => this._openEditOverlay(data));

      const replaceBtn = document.createElement("button");
      replaceBtn.className = "clb-action-btn";
      replaceBtn.textContent = "🔄 Replace";
      replaceBtn.addEventListener("click", () =>
        this._patch({ clauseId: "", data: null, status: "search", error: "" }));

      const copyBtn = document.createElement("button");
      copyBtn.className = "clb-action-btn";
      copyBtn.textContent = "📋 Copy";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(data.text || "").catch(() => {});
        copyBtn.textContent = "✅ Copied";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1500);
      });

      const unlinkBtn = document.createElement("button");
      unlinkBtn.className = "clb-action-btn clb-action-btn--danger";
      unlinkBtn.textContent = "🗑 Unlink";
      unlinkBtn.addEventListener("click", () => {
        if (confirm("Unlink this clause from the document?"))
          this._patch({ clauseId: "", data: null, status: "search", error: "" });
      });

      actions.append(editBtn, replaceBtn, copyBtn, unlinkBtn);

      if (data._localEdit) {
        const syncBtn = document.createElement("button");
        syncBtn.className = "clb-action-btn clb-action-btn--sync";
        syncBtn.textContent = "↩ Sync from library";
        syncBtn.title = "Discard local edit and reload the shared library version";
        syncBtn.addEventListener("click", () => {
          if (confirm("Discard local edit and reload from the library?"))
            this._loadClause(this.node.attrs.clauseId);
        });
        actions.appendChild(syncBtn);
      }
      this.dom.appendChild(actions);
    }
  }

  // ── Edit text overlay ─────────────────────────────────────────────────────

  _openEditOverlay(data) {
    this.dom.querySelector(".clb-editor-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "clb-editor-overlay";

    const panel = document.createElement("div");
    panel.className = "clb-editor-panel";

    const panelTitle = document.createElement("div");
    panelTitle.className = "clb-editor-title";
    panelTitle.textContent = "Edit Clause Text";
    panel.appendChild(panelTitle);

    // Staleness warning
    if (data.last_reviewed_at) {
      const daysSince = Math.floor(
        (Date.now() - new Date(data.last_reviewed_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSince > 365) {
        const warn = document.createElement("div");
        warn.className = "clb-editor-warn";
        warn.innerHTML = `⚠️ This clause was last reviewed <strong>${daysSince} days ago</strong> — consider legal review before editing.`;
        panel.appendChild(warn);
      }
    }

    const textarea = document.createElement("textarea");
    textarea.className = "clb-editor-textarea";
    textarea.value = data.text || "";
    textarea.rows = 12;
    panel.appendChild(textarea);

    const btnRow = document.createElement("div");
    btnRow.className = "clb-editor-btns";

    const saveLibraryBtn = document.createElement("button");
    saveLibraryBtn.className = "clb-editor-save";
    saveLibraryBtn.textContent = "Save to library";
    saveLibraryBtn.title = "Updates this clause for everyone who uses it";
    saveLibraryBtn.addEventListener("click", async () => {
      const newText = textarea.value.trim();
      overlay.remove();
      await this._saveClauseText(data.id, newText);
    });

    const saveLocalBtn = document.createElement("button");
    saveLocalBtn.className = "clb-editor-save-local";
    saveLocalBtn.textContent = "Save locally only";
    saveLocalBtn.title = "Only changes this document — the shared library is not affected";
    saveLocalBtn.addEventListener("click", () => {
      const newText = textarea.value.trim();
      overlay.remove();
      this._patch({
        data: { ...data, text: newText, _localEdit: true },
        status: "loaded",
      });
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "clb-editor-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.append(saveLibraryBtn, saveLocalBtn, cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    this.dom.appendChild(overlay);
    textarea.focus();
  }

  async _saveClauseText(id, text) {
    this._patch({ status: "loading" });
    try {
      const updated = await this._apiFetch(`/clauses/${id}`, {
        method: "PATCH",
        body: { text, last_reviewed_at: new Date().toISOString() },
      });
      // Increment version display locally if API doesn't return it
      const prev = this.node.attrs.data || {};
      const merged = { ...prev, ...updated };
      if (typeof merged.version === "number") merged.version = merged.version + 1;
      this._patch({ data: merged, status: "loaded", error: "" });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  _divider() {
    const hr = document.createElement("hr");
    hr.className = "clb-divider";
    return hr;
  }

  // ── ProseMirror interface ─────────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._build();
    return true;
  }

  stopEvent()      { return true; }
  ignoreMutation() { return true; }

  destroy() {
    this.dom.innerHTML = "";
  }
}
