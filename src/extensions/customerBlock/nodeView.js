/**
 * CustomerBlockNodeView
 *
 * A live block connected to the Customer CRM API (via /api/crm proxy).
 *
 * States:
 *   search  — unconfigured: search box to find or pick a customer
 *   loading — fetching from API
 *   loaded  — shows customer card with tabs (Overview / Assets / Interactions)
 *   error   — API unreachable or customer deleted
 *
 * Edit mode: click ✏️ to make fields editable → PATCH back on Save.
 * Read-only mode: readonly display only, no edit controls.
 */

const STATUS_COLORS = {
  prospect: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  active:   { bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
  inactive: { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" },
  churned:  { bg: "#fef2f2", text: "#991b1b", border: "#fecaca" },
};
const TYPE_COLORS = {
  standard:   { bg: "#f9fafb", text: "#374151" },
  premium:    { bg: "#fefce8", text: "#854d0e" },
  enterprise: { bg: "#faf5ff", text: "#6b21a8" },
};
const ASSET_STATUS = {
  operational:     { dot: "#16a34a", label: "Operational" },
  maintenance:     { dot: "#ca8a04", label: "Maintenance" },
  offline:         { dot: "#dc2626", label: "Offline"      },
  decommissioned:  { dot: "#94a3b8", label: "Decommissioned" },
};
const INTERACTION_ICONS = {
  note: "📝", call: "📞", visit: "🏢",
  email: "✉️", maintenance: "🔧", alert: "⚠️",
};

export class CustomerBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._editing = false;

    this.dom = document.createElement("div");
    this.dom.className = "cb-block";
    this._build();
  }

  // ── Patch helpers ─────────────────────────────────────────────────────────

  _patch(patch) {
    const { state, dispatch } = this.view;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...patch }));
  }

  get _readonly() { return this.view.props.editable?.() === false; }

  // ── API helpers ───────────────────────────────────────────────────────────

  async _apiFetch(path, opts = {}) {
    const res = await fetch(`/api/crm${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok && res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async _loadCustomer(id) {
    this._patch({ status: "loading" });
    try {
      const [customer, assetsRes, interactionsRes] = await Promise.all([
        this._apiFetch(`/customers/${id}`),
        this._apiFetch(`/customers/${id}/assets`),
        this._apiFetch(`/customers/${id}/interactions?limit=20`),
      ]);
      this._patch({
        customerId:   customer.id,
        data:         customer,
        assets:       assetsRes.data || [],
        interactions: interactionsRes.data || [],
        status:       "synced",
        lastSync:     Date.now(),
        error:        "",
      });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  async _patchCustomer(changes) {
    const { customerId } = this.node.attrs;
    try {
      const updated = await this._apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: changes,
      });
      this._patch({ data: updated, status: "synced", lastSync: Date.now() });
    } catch (e) {
      this._patch({ status: "error", error: e.message });
    }
  }

  async _addAsset(assetData) {
    const { customerId } = this.node.attrs;
    try {
      const newAsset = await this._apiFetch(`/customers/${customerId}/assets`, {
        method: "POST",
        body: assetData,
      });
      this._patch({ assets: [...this.node.attrs.assets, newAsset] });
    } catch (e) {
      alert(`Failed to add asset: ${e.message}`);
    }
  }

  async _addInteraction(intData) {
    const { customerId } = this.node.attrs;
    try {
      const newInt = await this._apiFetch(`/customers/${customerId}/interactions`, {
        method: "POST",
        body: intData,
      });
      this._patch({ interactions: [newInt, ...this.node.attrs.interactions] });
    } catch (e) {
      alert(`Failed to log interaction: ${e.message}`);
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    const { customerId, status, error } = this.node.attrs;

    if (!customerId) {
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
    wrap.className = "cb-search";
    wrap.innerHTML = `
      <div class="cb-search-header">
        <span class="cb-search-icon">👤</span>
        <span class="cb-search-title">Link Customer</span>
      </div>
      <div class="cb-search-body">
        <input class="cb-search-input" placeholder="Search by name, email or company…" />
        <div class="cb-search-results"></div>
      </div>`;

    const input   = wrap.querySelector(".cb-search-input");
    const results = wrap.querySelector(".cb-search-results");

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      debounce = setTimeout(() => this._doSearch(q, results), 300);
    });

    this.dom.appendChild(wrap);
    if (!this._readonly) setTimeout(() => input.focus(), 50);
  }

  async _doSearch(q, results) {
    results.innerHTML = `<div class="cb-search-spinner">Searching…</div>`;
    try {
      const res = await this._apiFetch(`/customers?search=${encodeURIComponent(q)}&limit=6`);
      if (!res.data.length) {
        results.innerHTML = `<div class="cb-search-empty">No customers found for "${q}"</div>`;
        return;
      }
      results.innerHTML = "";
      res.data.forEach(c => {
        const row = document.createElement("div");
        row.className = "cb-search-row";
        const sc = STATUS_COLORS[c.status] || STATUS_COLORS.active;
        row.innerHTML = `
          <div class="cb-search-row-main">
            <span class="cb-search-row-name">${c.name}</span>
            <span class="cb-search-row-company">${c.company || ""}</span>
          </div>
          <span class="cb-search-row-status" style="background:${sc.bg};color:${sc.text};border-color:${sc.border}">${c.status}</span>`;
        row.addEventListener("click", () => this._loadCustomer(c.id));
        results.appendChild(row);
      });
    } catch {
      results.innerHTML = `<div class="cb-search-empty">Could not reach CRM — is the server running?</div>`;
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  _buildLoading() {
    const el = document.createElement("div");
    el.className = "cb-loading";
    el.innerHTML = `<span class="cb-spinner"></span> Loading customer…`;
    this.dom.appendChild(el);
  }

  // ── Error state ───────────────────────────────────────────────────────────

  _buildError(msg) {
    const el = document.createElement("div");
    el.className = "cb-error";
    el.innerHTML = `
      <span>⚠️ ${msg || "Could not load customer"}</span>
      <button class="cb-error-retry">Retry</button>
      <button class="cb-error-unlink">Unlink</button>`;
    el.querySelector(".cb-error-retry").addEventListener("click", () =>
      this._loadCustomer(this.node.attrs.customerId));
    el.querySelector(".cb-error-unlink").addEventListener("click", () =>
      this._patch({ customerId: "", data: null, assets: [], interactions: [], status: "idle" }));
    this.dom.appendChild(el);
  }

  // ── Main card ─────────────────────────────────────────────────────────────

  _buildCard() {
    const { data, assets, interactions, lastSync, activeTab } = this.node.attrs;
    if (!data) return this._buildSearch();

    const sc = STATUS_COLORS[data.status] || STATUS_COLORS.active;
    const tc = TYPE_COLORS[data.type]     || TYPE_COLORS.standard;

    // ── Header ───────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "cb-header";

    const avatar = document.createElement("div");
    avatar.className = "cb-avatar";
    avatar.textContent = (data.name || "?")[0].toUpperCase();

    const info = document.createElement("div");
    info.className = "cb-info";
    info.innerHTML = `
      <div class="cb-name">${data.name}</div>
      <div class="cb-meta">
        ${data.company ? `<span class="cb-company">${data.company}</span>` : ""}
        ${data.email   ? `<a class="cb-email" href="mailto:${data.email}">${data.email}</a>` : ""}
        ${data.phone   ? `<span class="cb-phone">${data.phone}</span>` : ""}
      </div>`;

    const badges = document.createElement("div");
    badges.className = "cb-badges";
    badges.innerHTML = `
      <span class="cb-badge" style="background:${sc.bg};color:${sc.text};border-color:${sc.border}">${data.status}</span>
      <span class="cb-badge" style="background:${tc.bg};color:${tc.text}">${data.type}</span>`;

    const actions = document.createElement("div");
    actions.className = "cb-header-actions";

    if (!this._readonly) {
      const syncBtn = document.createElement("button");
      syncBtn.className = "cb-action-btn";
      syncBtn.title = `Last synced: ${lastSync ? new Date(lastSync).toLocaleTimeString() : "never"}`;
      syncBtn.textContent = "↺";
      syncBtn.addEventListener("click", () => this._loadCustomer(data.id));

      const editBtn = document.createElement("button");
      editBtn.className = "cb-action-btn";
      editBtn.textContent = this._editing ? "✕" : "✏️";
      editBtn.addEventListener("click", () => {
        this._editing = !this._editing;
        this._build();
      });

      const unlinkBtn = document.createElement("button");
      unlinkBtn.className = "cb-action-btn cb-action-btn--danger";
      unlinkBtn.title = "Unlink customer";
      unlinkBtn.textContent = "⊗";
      unlinkBtn.addEventListener("click", () => {
        if (confirm("Unlink this customer from the document?"))
          this._patch({ customerId: "", data: null, assets: [], interactions: [], status: "idle" });
      });

      actions.append(syncBtn, editBtn, unlinkBtn);
    }

    header.append(avatar, info, badges, actions);

    // ── Edit form ─────────────────────────────────────────────────────────────
    let editForm = null;
    if (this._editing && !this._readonly) {
      editForm = this._buildEditForm(data);
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const tab = activeTab || "assets";

    const tabBar = document.createElement("div");
    tabBar.className = "cb-tabbar";
    [
      ["assets",       `Assets (${assets.length})`],
      ["interactions", `Interactions (${interactions.length})`],
    ].forEach(([key, label]) => {
      const btn = document.createElement("button");
      btn.className = "cb-tab" + (tab === key ? " cb-tab--active" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => this._patch({ activeTab: key }));
      tabBar.appendChild(btn);
    });

    const tabContent = document.createElement("div");
    tabContent.className = "cb-tab-content";
    if (tab === "assets")       tabContent.appendChild(this._buildAssets(assets));
    if (tab === "interactions")  tabContent.appendChild(this._buildInteractions(interactions));

    if (editForm)   this.dom.append(header, editForm, tabBar, tabContent);
    else            this.dom.append(header, tabBar, tabContent);
  }

  // ── Edit form ─────────────────────────────────────────────────────────────

  _buildEditForm(data) {
    const form = document.createElement("div");
    form.className = "cb-edit-form";

    const field = (label, name, value, opts = {}) => {
      const row = document.createElement("div");
      row.className = "cb-edit-field";
      const lbl = document.createElement("label");
      lbl.className = "cb-edit-label";
      lbl.textContent = label;

      let input;
      if (opts.select) {
        input = document.createElement("select");
        input.className = "cb-edit-input";
        opts.select.forEach(o => {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o;
          if (o === value) opt.selected = true;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement("input");
        input.className = "cb-edit-input";
        input.value = value || "";
        input.placeholder = opts.placeholder || "";
      }
      input.dataset.field = name;
      row.append(lbl, input);
      return row;
    };

    form.append(
      field("Name",    "name",    data.name),
      field("Email",   "email",   data.email,   { placeholder: "contact@company.com" }),
      field("Phone",   "phone",   data.phone,   { placeholder: "+1 555 000 0000" }),
      field("Company", "company", data.company),
      field("Status",  "status",  data.status,  { select: ["prospect","active","inactive","churned"] }),
      field("Type",    "type",    data.type,    { select: ["standard","premium","enterprise"] }),
    );

    const btnRow = document.createElement("div");
    btnRow.className = "cb-edit-btns";

    const saveBtn = document.createElement("button");
    saveBtn.className = "cb-save-btn";
    saveBtn.textContent = "Save changes";
    saveBtn.addEventListener("click", async () => {
      const changes = {};
      form.querySelectorAll("[data-field]").forEach(el => {
        changes[el.dataset.field] = el.value;
      });
      this._editing = false;
      await this._patchCustomer(changes);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cb-cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => { this._editing = false; this._build(); });

    btnRow.append(saveBtn, cancelBtn);
    form.appendChild(btnRow);
    return form;
  }

  // ── Assets tab ────────────────────────────────────────────────────────────

  _buildAssets(assets) {
    const wrap = document.createElement("div");
    wrap.className = "cb-assets";

    if (!assets.length) {
      const empty = document.createElement("div");
      empty.className = "cb-empty";
      empty.textContent = "No assets linked to this customer yet.";
      wrap.appendChild(empty);
    } else {
      assets.forEach(a => {
        const s = ASSET_STATUS[a.status] || ASSET_STATUS.operational;
        const row = document.createElement("div");
        row.className = "cb-asset-row";
        row.innerHTML = `
          <span class="cb-asset-dot" style="background:${s.dot}"></span>
          <div class="cb-asset-info">
            <span class="cb-asset-name">${a.name}</span>
            <span class="cb-asset-meta">${[a.type, a.manufacturer, a.model, a.location].filter(Boolean).join(" · ")}</span>
          </div>
          <span class="cb-asset-status">${s.label}</span>`;
        if (a.serial_number) row.title = `S/N: ${a.serial_number}`;
        wrap.appendChild(row);
      });
    }

    if (!this._readonly) {
      const addBtn = document.createElement("button");
      addBtn.className = "cb-add-btn";
      addBtn.textContent = "+ Add asset";
      addBtn.addEventListener("click", () => this._openAssetForm());
      wrap.appendChild(addBtn);
    }

    return wrap;
  }

  // ── Interactions tab ──────────────────────────────────────────────────────

  _buildInteractions(interactions) {
    const wrap = document.createElement("div");
    wrap.className = "cb-interactions";

    if (!interactions.length) {
      const empty = document.createElement("div");
      empty.className = "cb-empty";
      empty.textContent = "No interactions recorded yet.";
      wrap.appendChild(empty);
    } else {
      interactions.forEach(i => {
        const row = document.createElement("div");
        row.className = "cb-int-row";
        const date = new Date(i.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
        row.innerHTML = `
          <span class="cb-int-icon">${INTERACTION_ICONS[i.type] || "📝"}</span>
          <div class="cb-int-body">
            <div class="cb-int-header">
              <span class="cb-int-title">${i.title || i.type}</span>
              <span class="cb-int-date">${date}</span>
            </div>
            ${i.notes  ? `<p class="cb-int-notes">${i.notes}</p>` : ""}
            ${i.created_by ? `<span class="cb-int-author">— ${i.created_by}</span>` : ""}
            ${i.asset_name ? `<span class="cb-int-asset">📦 ${i.asset_name}</span>` : ""}
          </div>`;
        wrap.appendChild(row);
      });
    }

    if (!this._readonly) {
      const logBtn = document.createElement("button");
      logBtn.className = "cb-add-btn";
      logBtn.textContent = "+ Log interaction";
      logBtn.addEventListener("click", () => this._openInteractionForm());
      wrap.appendChild(logBtn);
    }

    return wrap;
  }

  // ── Mini forms (overlay) ──────────────────────────────────────────────────

  _openAssetForm() {
    this.dom.querySelector(".cb-form-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cb-form-overlay";

    const panel = document.createElement("div");
    panel.className = "cb-form-panel";
    panel.innerHTML = `<div class="cb-form-title">Add Asset</div>`;

    const mk = (label, name, placeholder = "") => {
      const row = document.createElement("div");
      row.className = "cb-edit-field";
      row.innerHTML = `<label class="cb-edit-label">${label}</label>
        <input class="cb-edit-input" name="${name}" placeholder="${placeholder}">`;
      return row;
    };

    const statusSel = document.createElement("div");
    statusSel.className = "cb-edit-field";
    statusSel.innerHTML = `<label class="cb-edit-label">Status</label>
      <select class="cb-edit-input" name="status">
        <option value="operational">Operational</option>
        <option value="maintenance">Maintenance</option>
        <option value="offline">Offline</option>
        <option value="decommissioned">Decommissioned</option>
      </select>`;

    panel.append(
      mk("Name *",        "name",          "e.g. Pump CP-101"),
      mk("Type",          "type",          "pump / motor / sensor…"),
      mk("Manufacturer",  "manufacturer",  "e.g. Grundfos"),
      mk("Model",         "model",         ""),
      mk("Serial number", "serial_number", ""),
      mk("Location",      "location",      "Building A – Floor 2"),
      statusSel,
    );

    const btns = document.createElement("div");
    btns.className = "cb-edit-btns";
    const save   = document.createElement("button");
    save.className   = "cb-save-btn";
    save.textContent = "Add asset";
    const cancel = document.createElement("button");
    cancel.className   = "cb-cancel-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => overlay.remove());
    btns.append(save, cancel);
    panel.appendChild(btns);

    save.addEventListener("click", async () => {
      const data = {};
      panel.querySelectorAll("[name]").forEach(el => { if (el.value) data[el.name] = el.value; });
      if (!data.name) { panel.querySelector("[name=name]").focus(); return; }
      overlay.remove();
      await this._addAsset(data);
    });

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    this.dom.appendChild(overlay);
    panel.querySelector("[name=name]").focus();
  }

  _openInteractionForm() {
    this.dom.querySelector(".cb-form-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cb-form-overlay";

    const panel = document.createElement("div");
    panel.className = "cb-form-panel";
    panel.innerHTML = `<div class="cb-form-title">Log Interaction</div>
      <div class="cb-edit-field">
        <label class="cb-edit-label">Type</label>
        <select class="cb-edit-input" name="type">
          <option value="note">📝 Note</option>
          <option value="call">📞 Call</option>
          <option value="visit">🏢 Visit</option>
          <option value="email">✉️ Email</option>
          <option value="maintenance">🔧 Maintenance</option>
          <option value="alert">⚠️ Alert</option>
        </select>
      </div>
      <div class="cb-edit-field">
        <label class="cb-edit-label">Title</label>
        <input class="cb-edit-input" name="title" placeholder="Brief subject">
      </div>
      <div class="cb-edit-field">
        <label class="cb-edit-label">Notes</label>
        <textarea class="cb-edit-input cb-edit-textarea" name="notes" placeholder="Details…"></textarea>
      </div>
      <div class="cb-edit-field">
        <label class="cb-edit-label">Your name</label>
        <input class="cb-edit-input" name="created_by" placeholder="Author">
      </div>`;

    const btns = document.createElement("div");
    btns.className = "cb-edit-btns";
    const save   = document.createElement("button");
    save.className   = "cb-save-btn";
    save.textContent = "Log";
    const cancel = document.createElement("button");
    cancel.className   = "cb-cancel-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => overlay.remove());
    btns.append(save, cancel);
    panel.appendChild(btns);

    save.addEventListener("click", async () => {
      const data = {};
      panel.querySelectorAll("[name]").forEach(el => { if (el.value) data[el.name] = el.value; });
      overlay.remove();
      await this._addInteraction(data);
    });

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    this.dom.appendChild(overlay);
    panel.querySelector("[name=title]").focus();
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
}
