/**
 * PartyBlockNodeView
 *
 * A live block connected to the Lex party API (via /api/lex proxy).
 *
 * States:
 *   search  — unconfigured: search box to find a party
 *   loading — fetching from API
 *   loaded  — shows party card with contact details, signatory, sanctions status
 *   error   — API unreachable or party not found
 *
 * Edit mode: "✏️ Edit" opens inline overlay to update signatory / contact fields.
 * Replace:   shows search UI again to swap for a different party.
 * Unlink:    resets to search state (removes partyId from attrs).
 * Read-only: hides all edit/replace/unlink controls.
 */

// ── Color maps ────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  company:    { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  individual: { bg: "#f0fdf4", text: "#065f46", border: "#a7f3d0" },
  government: { bg: "#fefce8", text: "#a16207", border: "#fde68a" },
  ngo:        { bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
};

const PARTY_TYPES = ["company", "individual", "government", "ngo"];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class PartyBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "pb-block";
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

  // ── Load party ────────────────────────────────────────────────────────────

  async _loadParty(id) {
    this._patch({ status: "loading", partyId: id });
    try {
      const party = await this._apiFetch(`/parties/${id}`);
      this._patch({
        partyId: party.id,
        data:    party,
        status:  "loaded",
        error:   "",
      });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  // ── Build dispatcher ──────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    const { partyId, status, error } = this.node.attrs;

    if (status === "search" || !partyId) {
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
    wrap.className = "pb-search";

    const header = document.createElement("div");
    header.className = "pb-search-header";
    header.innerHTML = `<span class="pb-search-icon">🏢</span>
      <span class="pb-search-title">Link Party</span>`;

    const input = document.createElement("input");
    input.className = "pb-search-input";
    input.placeholder = "Search parties by name, registration number…";

    const results = document.createElement("div");
    results.className = "pb-search-results";

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      debounce = setTimeout(() => this._doSearch(q, results), 300);
    });

    wrap.append(header, input, results);
    this.dom.appendChild(wrap);
    if (!this._readonly) setTimeout(() => input.focus(), 50);
  }

  async _doSearch(q, results) {
    results.innerHTML = `<div class="pb-search-spinner">Searching…</div>`;
    try {
      const res = await this._apiFetch(`/parties?search=${encodeURIComponent(q)}&limit=8`);
      const list = res.data || res;
      if (!list.length) {
        results.innerHTML = `<div class="pb-search-empty">No parties found for "${q}"</div>`;
        return;
      }
      results.innerHTML = "";
      list.forEach(p => {
        const row = document.createElement("div");
        row.className = "pb-search-row";
        const tc = TYPE_COLORS[p.type] || TYPE_COLORS.company;
        row.innerHTML = `
          <div class="pb-search-row-main">
            <span class="pb-search-row-name">${p.name}</span>
            <span class="pb-search-row-meta">${[p.jurisdiction, p.registration_number].filter(Boolean).join(" · ")}</span>
          </div>
          <span class="pb-badge" style="background:${tc.bg};color:${tc.text};border-color:${tc.border}">${p.type || "company"}</span>`;
        row.addEventListener("click", () => this._loadParty(p.id));
        results.appendChild(row);
      });
    } catch {
      results.innerHTML = `<div class="pb-search-empty">Could not reach Lex API — is the server running?</div>`;
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  _buildLoading() {
    const el = document.createElement("div");
    el.className = "pb-loading";
    el.innerHTML = `<span class="pb-spinner"></span> Loading party…`;
    this.dom.appendChild(el);
  }

  // ── Error state ───────────────────────────────────────────────────────────

  _buildError(msg) {
    const el = document.createElement("div");
    el.className = "pb-error";
    el.innerHTML = `
      <span>⚠️ ${msg || "Could not load party"}</span>
      <button class="pb-error-retry">Retry</button>
      <button class="pb-error-unlink">Unlink</button>`;
    el.querySelector(".pb-error-retry").addEventListener("click", () =>
      this._loadParty(this.node.attrs.partyId));
    el.querySelector(".pb-error-unlink").addEventListener("click", () =>
      this._patch({ partyId: "", data: null, status: "search", error: "" }));
    this.dom.appendChild(el);
  }

  // ── Loaded card ───────────────────────────────────────────────────────────

  _buildCard() {
    const { data } = this.node.attrs;
    if (!data) { this._buildSearch(); return; }

    const tc = TYPE_COLORS[data.type] || TYPE_COLORS.company;

    // ── Header row ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "pb-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "pb-header-left";
    headerLeft.innerHTML = `<span class="pb-icon">🏢</span>
      <span class="pb-badge" style="background:${tc.bg};color:${tc.text};border-color:${tc.border}">${data.type || "company"}</span>`;
    header.appendChild(headerLeft);
    this.dom.appendChild(header);

    // ── Name + jurisdiction ───────────────────────────────────────────────────
    const nameEl = document.createElement("div");
    nameEl.className = "pb-name";
    nameEl.textContent = data.name || "Unnamed Party";
    this.dom.appendChild(nameEl);

    if (data.jurisdiction) {
      const jurisEl = document.createElement("div");
      jurisEl.className = "pb-jurisdiction";
      jurisEl.textContent = `Jurisdiction: ${data.jurisdiction}`;
      this.dom.appendChild(jurisEl);
    }

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Contact details ───────────────────────────────────────────────────────
    const details = document.createElement("div");
    details.className = "pb-details";

    if (data.signatory_name) {
      const sigRow = document.createElement("div");
      sigRow.className = "pb-detail-row";
      sigRow.innerHTML = `<span class="pb-detail-icon">✍</span>
        <span>Signatory: <strong>${data.signatory_name}</strong>${data.signatory_title ? `, ${data.signatory_title}` : ""}</span>`;
      details.appendChild(sigRow);
    }

    if (data.email) {
      const emailRow = document.createElement("div");
      emailRow.className = "pb-detail-row";
      emailRow.innerHTML = `<span class="pb-detail-icon">📧</span>
        <a href="mailto:${data.email}" class="pb-link">${data.email}</a>`;
      if (data.phone) {
        emailRow.innerHTML += ` <span class="pb-detail-sep">·</span>
          <span class="pb-detail-icon">📞</span>
          <span>${data.phone}</span>`;
      }
      details.appendChild(emailRow);
    } else if (data.phone) {
      const phoneRow = document.createElement("div");
      phoneRow.className = "pb-detail-row";
      phoneRow.innerHTML = `<span class="pb-detail-icon">📞</span><span>${data.phone}</span>`;
      details.appendChild(phoneRow);
    }

    if (data.registration_number) {
      const regRow = document.createElement("div");
      regRow.className = "pb-detail-row";
      regRow.innerHTML = `<span class="pb-detail-icon">🏛</span>
        <span>Reg: ${data.registration_number}</span>`;
      details.appendChild(regRow);
    }

    this.dom.appendChild(details);

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Sanctions status ──────────────────────────────────────────────────────
    const sanctions = document.createElement("div");
    sanctions.className = "pb-sanctions";

    if (data.sanctions_cleared_at) {
      const d = new Date(data.sanctions_cleared_at);
      const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      sanctions.innerHTML = `<span class="pb-sanctions-ok">✅ Sanctions cleared: ${dateStr}</span>`;
    } else {
      sanctions.innerHTML = `<span class="pb-sanctions-warn">⚠️ Sanctions check required</span>`;
    }

    this.dom.appendChild(sanctions);

    // ── Divider ──────────────────────────────────────────────────────────────
    this.dom.appendChild(this._divider());

    // ── Action bar ────────────────────────────────────────────────────────────
    if (!this._readonly) {
      const actions = document.createElement("div");
      actions.className = "pb-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "pb-action-btn";
      editBtn.textContent = "✏️ Edit";
      editBtn.addEventListener("click", () => this._openEditOverlay(data));

      const replaceBtn = document.createElement("button");
      replaceBtn.className = "pb-action-btn";
      replaceBtn.textContent = "🔄 Replace";
      replaceBtn.addEventListener("click", () =>
        this._patch({ partyId: "", data: null, status: "search", error: "" }));

      const unlinkBtn = document.createElement("button");
      unlinkBtn.className = "pb-action-btn pb-action-btn--danger";
      unlinkBtn.textContent = "🗑 Unlink";
      unlinkBtn.addEventListener("click", () => {
        if (confirm("Unlink this party from the document?"))
          this._patch({ partyId: "", data: null, status: "search", error: "" });
      });

      actions.append(editBtn, replaceBtn, unlinkBtn);
      this.dom.appendChild(actions);
    }
  }

  // ── Edit overlay ──────────────────────────────────────────────────────────

  _openEditOverlay(data) {
    this.dom.querySelector(".pb-editor-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "pb-editor-overlay";

    const panel = document.createElement("div");
    panel.className = "pb-editor-panel";

    const panelTitle = document.createElement("div");
    panelTitle.className = "pb-editor-title";
    panelTitle.textContent = "Edit Party Details";
    panel.appendChild(panelTitle);

    const field = (label, name, value, placeholder = "") => {
      const row = document.createElement("div");
      row.className = "pb-editor-field";
      const lbl = document.createElement("label");
      lbl.className = "pb-editor-label";
      lbl.textContent = label;
      const input = document.createElement("input");
      input.className = "pb-editor-input";
      input.name = name;
      input.value = value || "";
      input.placeholder = placeholder;
      row.append(lbl, input);
      return row;
    };

    const notesRow = document.createElement("div");
    notesRow.className = "pb-editor-field";
    const notesLbl = document.createElement("label");
    notesLbl.className = "pb-editor-label";
    notesLbl.textContent = "Notes";
    const notesArea = document.createElement("textarea");
    notesArea.className = "pb-editor-textarea";
    notesArea.name = "notes";
    notesArea.value = data.notes || "";
    notesArea.placeholder = "Internal notes…";
    notesArea.rows = 3;
    notesRow.append(notesLbl, notesArea);

    panel.append(
      field("Signatory name",  "signatory_name",  data.signatory_name,  "e.g. Jane Smith"),
      field("Signatory title", "signatory_title", data.signatory_title, "e.g. CEO"),
      field("Email",           "email",           data.email,           "legal@company.com"),
      field("Phone",           "phone",           data.phone,           "+44 20 7123 4567"),
      notesRow,
    );

    const btnRow = document.createElement("div");
    btnRow.className = "pb-editor-btns";

    const saveBtn = document.createElement("button");
    saveBtn.className = "pb-editor-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const changes = {};
      panel.querySelectorAll("[name]").forEach(el => {
        changes[el.name] = el.value;
      });
      overlay.remove();
      await this._savePartyDetails(data.id, changes);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pb-editor-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.append(saveBtn, cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    this.dom.appendChild(overlay);
    panel.querySelector("[name=signatory_name]").focus();
  }

  async _savePartyDetails(id, changes) {
    this._patch({ status: "loading" });
    try {
      const updated = await this._apiFetch(`/parties/${id}`, {
        method: "PATCH",
        body: changes,
      });
      const prev   = this.node.attrs.data || {};
      const merged = { ...prev, ...updated };
      this._patch({ data: merged, status: "loaded", error: "" });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  _divider() {
    const hr = document.createElement("hr");
    hr.className = "pb-divider";
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
