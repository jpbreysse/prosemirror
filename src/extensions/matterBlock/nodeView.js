/**
 * MatterBlockNodeView
 *
 * A live block connected to the Lex matter API (via /api/lex proxy).
 *
 * States:
 *   search  — unconfigured: search box + type filter to find a matter
 *   loading — fetching from API
 *   loaded  — shows matter card with title, status, parties, deadlines
 *   error   — API unreachable or matter not found
 *
 * Edit mode: "🔄 Replace" shows search UI to swap; "🗑 Unlink" clears the block.
 * Read-only: hides Replace and Unlink buttons, shows "🔗 Open in LexDraft" only.
 */

// ── Color maps ────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  open:           { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe", dot: "#3b82f6" },
  in_negotiation: { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa", dot: "#f97316" },
  signed:         { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  closed:         { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0", dot: "#94a3b8" },
  archived:       { bg: "#f1f5f9", text: "#94a3b8", border: "#e2e8f0", dot: "#cbd5e1" },
  draft:          { bg: "#fdf4ff", text: "#7e22ce", border: "#e9d5ff", dot: "#a855f7" },
};

const TYPE_ICONS = {
  contract:   "📄",
  nda:        "🤝",
  msa:        "📋",
  sow:        "📐",
  amendment:  "✏️",
  license:    "🔑",
  employment: "👤",
  dispute:    "⚖️",
  regulatory: "🏛",
  advisory:   "💡",
  other:      "📁",
};

const MATTER_TYPES = [
  "all", "contract", "nda", "msa", "sow", "amendment",
  "license", "employment", "dispute", "regulatory", "advisory", "other",
];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class MatterBlockNodeView {
  constructor(node, view, getPos) {
    this.node      = node;
    this.view      = view;
    this.getPos    = getPos;
    this._expanded = false;

    this.dom = document.createElement("div");
    this.dom.className = "mb-block";
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

  // ── Load matter ───────────────────────────────────────────────────────────

  async _loadMatter(id) {
    this._patch({ status: "loading", matterId: id });
    try {
      const matter = await this._apiFetch(`/matters/${id}`);
      this._patch({
        matterId: matter.id,
        data:     matter,
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
    const { matterId, status, error } = this.node.attrs;

    if (status === "search" || !matterId) {
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
    wrap.className = "mb-search";

    const header = document.createElement("div");
    header.className = "mb-search-header";
    header.innerHTML = `<span class="mb-search-icon">📁</span>
      <span class="mb-search-title">Link Matter</span>`;

    const controls = document.createElement("div");
    controls.className = "mb-search-controls";

    const input = document.createElement("input");
    input.className = "mb-search-input";
    input.placeholder = "Search matters by title, reference…";

    const typeSelect = document.createElement("select");
    typeSelect.className = "mb-search-cat";
    MATTER_TYPES.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "all" ? "All types" : t.replace("_", " ");
      typeSelect.appendChild(opt);
    });

    controls.append(input, typeSelect);

    const results = document.createElement("div");
    results.className = "mb-search-results";

    let debounce;
    const doSearch = () => {
      clearTimeout(debounce);
      const q    = input.value.trim();
      const type = typeSelect.value;
      if (q.length < 2) { results.innerHTML = ""; return; }
      debounce = setTimeout(() => this._doSearch(q, type, results), 300);
    };

    input.addEventListener("input", doSearch);
    typeSelect.addEventListener("change", doSearch);

    wrap.append(header, controls, results);
    this.dom.appendChild(wrap);
    if (!this._readonly) setTimeout(() => input.focus(), 50);
  }

  async _doSearch(q, type, results) {
    results.innerHTML = `<div class="mb-search-spinner">Searching…</div>`;
    try {
      const params = new URLSearchParams({ search: q, limit: "8" });
      if (type && type !== "all") params.set("type", type);
      const res  = await this._apiFetch(`/matters?${params}`);
      const list = res.data || res;
      if (!list.length) {
        results.innerHTML = `<div class="mb-search-empty">No matters found for "${q}"</div>`;
        return;
      }
      results.innerHTML = "";
      list.forEach(m => {
        const row = document.createElement("div");
        row.className = "mb-search-row";
        const sc   = STATUS_COLORS[m.status] || STATUS_COLORS.open;
        const icon = TYPE_ICONS[m.type]      || TYPE_ICONS.other;
        row.innerHTML = `
          <div class="mb-search-row-main">
            <span class="mb-search-row-title">${icon} ${m.title}</span>
            <span class="mb-search-row-meta">${[m.reference, m.type].filter(Boolean).join(" · ")}</span>
          </div>
          <span class="mb-badge" style="background:${sc.bg};color:${sc.text};border-color:${sc.border}">
            <span class="mb-badge-dot" style="background:${sc.dot}"></span>${m.status || "open"}
          </span>`;
        row.addEventListener("click", () => this._loadMatter(m.id));
        results.appendChild(row);
      });
    } catch {
      results.innerHTML = `<div class="mb-search-empty">Could not reach Lex API — is the server running?</div>`;
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  _buildLoading() {
    const el = document.createElement("div");
    el.className = "mb-loading";
    el.innerHTML = `<span class="mb-spinner"></span> Loading matter…`;
    this.dom.appendChild(el);
  }

  // ── Error state ───────────────────────────────────────────────────────────

  _buildError(msg) {
    const el = document.createElement("div");
    el.className = "mb-error";
    el.innerHTML = `
      <span>⚠️ ${msg || "Could not load matter"}</span>
      <button class="mb-error-retry">Retry</button>
      <button class="mb-error-unlink">Unlink</button>`;
    el.querySelector(".mb-error-retry").addEventListener("click", () =>
      this._loadMatter(this.node.attrs.matterId));
    el.querySelector(".mb-error-unlink").addEventListener("click", () =>
      this._patch({ matterId: null, data: null, status: "search", error: "" }));
    this.dom.appendChild(el);
  }

  // ── Loaded card ───────────────────────────────────────────────────────────

  _buildCard() {
    const { data } = this.node.attrs;
    if (!data) { this._buildSearch(); return; }

    const sc   = STATUS_COLORS[data.status] || STATUS_COLORS.open;
    const icon = TYPE_ICONS[data.type]      || TYPE_ICONS.other;

    // ── Header row ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "mb-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "mb-header-left";
    headerLeft.innerHTML = `<span class="mb-icon">${icon}</span>
      <span class="mb-badge mb-badge--status" style="background:${sc.bg};color:${sc.text};border-color:${sc.border}">
        <span class="mb-badge-dot" style="background:${sc.dot}"></span>${data.status || "open"}
      </span>
      ${data.type ? `<span class="mb-badge mb-badge--type">${data.type}</span>` : ""}`;

    header.appendChild(headerLeft);
    this.dom.appendChild(header);

    // ── Title ────────────────────────────────────────────────────────────────
    const titleEl = document.createElement("div");
    titleEl.className = "mb-title";
    titleEl.textContent = data.title || "Untitled Matter";
    this.dom.appendChild(titleEl);

    // ── Meta row ─────────────────────────────────────────────────────────────
    const metaEl = document.createElement("div");
    metaEl.className = "mb-meta";
    const metaParts = [];
    if (data.reference) metaParts.push(data.reference);
    if (data.opened_at) {
      const d = new Date(data.opened_at);
      metaParts.push(`Opened: ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`);
    }
    if (data.deadline) {
      const dl   = new Date(data.deadline);
      const past = dl < new Date();
      const dStr = dl.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      metaParts.push(`<span class="mb-meta-deadline${past ? " mb-meta-deadline--overdue" : ""}">⏰ Deadline: ${dStr}</span>`);
    }
    metaEl.innerHTML = metaParts.join(" · ");
    this.dom.appendChild(metaEl);

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Description ──────────────────────────────────────────────────────────
    if (data.description) {
      const descWrap = document.createElement("div");
      descWrap.className = "mb-description-wrap";

      const descEl = document.createElement("div");
      descEl.className = "mb-description" + (this._expanded ? "" : " mb-description--collapsed");
      descEl.textContent = data.description;
      descWrap.appendChild(descEl);

      // Show expand toggle only if text is likely longer than 2 lines (~160 chars)
      if (data.description.length > 160) {
        const toggle = document.createElement("button");
        toggle.className = "mb-expand-btn";
        toggle.textContent = this._expanded ? "▲ Collapse" : "▼ Show more";
        toggle.addEventListener("click", () => {
          this._expanded = !this._expanded;
          this._build();
        });
        descWrap.appendChild(toggle);
      }

      this.dom.appendChild(descWrap);
      this.dom.appendChild(this._divider());
    }

    // ── Parties section ───────────────────────────────────────────────────────
    const parties = Array.isArray(data.parties) ? data.parties : [];
    if (parties.length) {
      const partiesWrap = document.createElement("div");
      partiesWrap.className = "mb-parties";

      const partiesLabel = document.createElement("div");
      partiesLabel.className = "mb-parties-label";
      partiesLabel.textContent = "Parties";
      partiesWrap.appendChild(partiesLabel);

      parties.forEach(p => {
        const row = document.createElement("div");
        row.className = "mb-party-row";

        const avatar = document.createElement("span");
        avatar.className = "mb-party-avatar";
        avatar.textContent = (p.name || "?").charAt(0).toUpperCase();

        const nameSpan = document.createElement("span");
        nameSpan.className = "mb-party-name";
        nameSpan.textContent = p.name || "Unknown";

        const roleSpan = document.createElement("span");
        roleSpan.className = "mb-party-role";
        roleSpan.textContent = p.role || "";

        row.append(avatar, nameSpan, roleSpan);
        partiesWrap.appendChild(row);
      });

      this.dom.appendChild(partiesWrap);
      this.dom.appendChild(this._divider());
    }

    // ── Action bar ────────────────────────────────────────────────────────────
    const actions = document.createElement("div");
    actions.className = "mb-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "mb-action-btn";
    openBtn.textContent = "🔗 Open in LexDraft";
    openBtn.addEventListener("click", () => {
      const url = data.url || `/lex.html?matter=${data.id}`;
      window.open(url, "_blank");
    });
    actions.appendChild(openBtn);

    if (!this._readonly) {
      const replaceBtn = document.createElement("button");
      replaceBtn.className = "mb-action-btn";
      replaceBtn.textContent = "🔄 Replace";
      replaceBtn.addEventListener("click", () =>
        this._patch({ matterId: null, data: null, status: "search", error: "" }));

      const unlinkBtn = document.createElement("button");
      unlinkBtn.className = "mb-action-btn mb-action-btn--danger";
      unlinkBtn.textContent = "🗑 Unlink";
      unlinkBtn.addEventListener("click", () => {
        if (confirm("Unlink this matter from the document?"))
          this._patch({ matterId: null, data: null, status: "search", error: "" });
      });

      actions.append(replaceBtn, unlinkBtn);
    }

    this.dom.appendChild(actions);
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  _divider() {
    const hr = document.createElement("hr");
    hr.className = "mb-divider";
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
