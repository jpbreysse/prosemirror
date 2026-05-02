/**
 * Connector Registry UI
 *
 * Manage external API connectors — register, edit, test, enable/disable.
 * Each connector is accessible via /api/connect/:name/* once registered.
 */

const API = "/api/connectors";

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── State ──────────────────────────────────────────────────────────────────────

let _connectors  = [];
let _formMode    = null;   // null | "add" | { ...connector } (edit)
let _testResults = {};     // name → { status, message }

// ── API helpers ────────────────────────────────────────────────────────────────

async function loadConnectors() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  _connectors = await res.json();
}

async function saveConnector(data, isEdit) {
  const url    = isEdit ? `${API}/${isEdit}` : API;
  const method = isEdit ? "PUT" : "POST";
  const res    = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteConnector(name) {
  await fetch(`${API}/${name}`, { method: "DELETE" });
}

async function toggleConnector(name, enabled) {
  await fetch(`${API}/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

async function testConnector(name) {
  _testResults[name] = { status: "loading", message: "Testing…" };
  renderMain();
  try {
    const start = Date.now();
    const res   = await fetch(`/api/connect/${name}/`, { signal: AbortSignal.timeout(5000) });
    const ms    = Date.now() - start;
    _testResults[name] = {
      status:  res.ok || res.status < 500 ? "ok" : "error",
      message: `HTTP ${res.status} · ${ms}ms`,
    };
  } catch (e) {
    _testResults[name] = { status: "error", message: e.message };
  }
  renderMain();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function render() {
  renderNav();
  renderMain();
}

// ── Nav ────────────────────────────────────────────────────────────────────────

function renderNav() {
  document.getElementById("conn-nav").innerHTML = `
    <a class="conn-back" href="/docs.html">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Documents
    </a>
    <span class="conn-nav-title">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42
                 M11.53 4.47l1.42-1.42M3.05 12.95l1.42-1.42"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      Connectors
    </span>
    <span class="conn-nav-count">${_connectors.length} registered</span>
    <button class="conn-add-btn" id="btnAdd">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      Add connector
    </button>`;

  document.getElementById("btnAdd").addEventListener("click", () => {
    _formMode = "add";
    render();
    document.querySelector(".conn-form-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

function renderMain() {
  const main = document.getElementById("conn-main");
  main.innerHTML = "";

  // Connector table
  main.appendChild(buildTable());

  // Endpoint helper box
  main.appendChild(buildEndpointHelper());

  // Add / Edit form
  if (_formMode !== null) {
    main.appendChild(buildForm());
  }
}

// ── Connector table ────────────────────────────────────────────────────────────

function buildTable() {
  const wrap = document.createElement("div");
  wrap.className = "conn-table-wrap";

  if (!_connectors.length) {
    wrap.innerHTML = `
      <div class="conn-empty">
        <strong>No connectors yet</strong>
        Click "Add connector" to register your first external API.
      </div>`;
    return wrap;
  }

  const table = document.createElement("table");
  table.className = "conn-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Label</th>
        <th>Base URL</th>
        <th>Auth</th>
        <th>Status</th>
        <th>Test</th>
        <th></th>
      </tr>
    </thead>`;

  const tbody = document.createElement("tbody");
  _connectors.forEach(c => tbody.appendChild(buildRow(c)));
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildRow(c) {
  const tr = document.createElement("tr");

  const authClass = {
    api_key: "",
    bearer:  "conn-auth-badge--bearer",
    basic:   "conn-auth-badge--basic",
    none:    "conn-auth-badge--none",
  }[c.auth_type] || "";

  const testR  = _testResults[c.name];
  const testHtml = testR
    ? `<span class="conn-test-result conn-test-result--${testR.status}">${escHtml(testR.message)}</span>`
    : `<button class="conn-btn conn-btn--test" data-test="${escHtml(c.name)}">Ping</button>`;

  tr.innerHTML = `
    <td><span class="conn-name">${escHtml(c.name)}</span></td>
    <td><span class="conn-label">${escHtml(c.label || c.name)}</span></td>
    <td><span class="conn-url" title="${escHtml(c.base_url)}">${escHtml(c.base_url)}</span></td>
    <td><span class="conn-auth-badge ${authClass}">${escHtml(c.auth_type)}</span></td>
    <td>
      <span class="conn-status conn-status--${c.enabled ? "enabled" : "disabled"}">
        <span class="conn-status-dot"></span>
        ${c.enabled ? "Enabled" : "Disabled"}
      </span>
    </td>
    <td>${testHtml}</td>
    <td>
      <div class="conn-actions">
        <button class="conn-btn" data-edit="${escHtml(c.name)}">${c.enabled ? "Disable" : "Enable"}</button>
        <button class="conn-btn" data-config="${escHtml(c.name)}">Edit</button>
        <button class="conn-btn conn-btn--danger" data-delete="${escHtml(c.name)}">Delete</button>
      </div>
    </td>`;

  // Wire actions
  tr.querySelector(`[data-test]`)?.addEventListener("click", () => testConnector(c.name));

  tr.querySelector(`[data-edit]`)?.addEventListener("click", async () => {
    await toggleConnector(c.name, !c.enabled);
    await loadConnectors();
    render();
  });

  tr.querySelector(`[data-config]`)?.addEventListener("click", () => {
    _formMode = { ...c };
    render();
    document.querySelector(".conn-form-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  tr.querySelector(`[data-delete]`)?.addEventListener("click", async () => {
    if (!confirm(`Delete connector "${c.name}"? This cannot be undone.`)) return;
    await deleteConnector(c.name);
    await loadConnectors();
    _formMode = null;
    render();
  });

  return tr;
}

// ── Endpoint helper ────────────────────────────────────────────────────────────

function buildEndpointHelper() {
  const box = document.createElement("div");
  box.className = "conn-endpoint-box";

  const examples = _connectors.slice(0, 2).map(c =>
    `GET /api/connect/<strong>${escHtml(c.name)}</strong>/your/path`
  ).join("<br>");

  box.innerHTML = `
    <div class="conn-endpoint-title">How to use a connector</div>
    <div style="font-size:13px;color:#374151;margin-bottom:4px">
      All connectors are available at <code style="background:#f4f4f5;padding:1px 5px;border-radius:4px">/api/connect/:name/*</code>.
      API credentials stay server-side — never exposed to the browser.
    </div>
    ${examples
      ? `<div class="conn-endpoint-url">${examples}</div>`
      : `<div class="conn-endpoint-url">GET /api/connect/<em>connector-name</em>/your/path</div>`
    }`;
  return box;
}

// ── Add / Edit form ────────────────────────────────────────────────────────────

function buildForm() {
  const isEdit   = typeof _formMode === "object" && _formMode !== null && _formMode !== "add";
  const defaults = isEdit ? _formMode : {};
  const title    = isEdit ? `Edit — ${_formMode.name}` : "Register new connector";

  const wrap = document.createElement("div");
  wrap.className = "conn-form-wrap";
  wrap.innerHTML = `
    <div class="conn-form-hdr">
      <span>${title}</span>
      <button class="conn-form-close" id="formClose">×</button>
    </div>
    <form class="conn-form" id="connForm" autocomplete="off">

      <div class="conn-form-field">
        <label>Name (slug) *</label>
        <input name="name" placeholder="e.g. sap-pm" required
          value="${escHtml(defaults.name || "")}"
          ${isEdit ? "readonly style=\"background:#f4f4f5;color:#6b7280\"" : ""}/>
        <span class="conn-form-hint">Used in URL: /api/connect/<strong>${defaults.name || "name"}</strong>/*</span>
      </div>

      <div class="conn-form-field">
        <label>Label</label>
        <input name="label" placeholder="e.g. SAP Plant Maintenance"
          value="${escHtml(defaults.label || "")}"/>
      </div>

      <div class="conn-form-field conn-form-field--full">
        <label>Base URL *</label>
        <input name="base_url" placeholder="https://your-system.company.com" required
          value="${escHtml(defaults.base_url || "")}"/>
      </div>

      <div class="conn-form-field">
        <label>Auth type</label>
        <select name="auth_type" id="authTypeSelect">
          <option value="api_key" ${(defaults.auth_type||"api_key")==="api_key"?"selected":""}>API Key (header)</option>
          <option value="bearer"  ${defaults.auth_type==="bearer" ?"selected":""}>Bearer token</option>
          <option value="basic"   ${defaults.auth_type==="basic"  ?"selected":""}>Basic auth (user:pass)</option>
          <option value="none"    ${defaults.auth_type==="none"   ?"selected":""}>None</option>
        </select>
      </div>

      <div class="conn-form-field" id="authHeaderField" style="${(defaults.auth_type==="bearer"||defaults.auth_type==="none")?"display:none":""}">
        <label>Auth header name</label>
        <input name="auth_header" placeholder="X-API-Key"
          value="${escHtml(defaults.auth_header || "X-API-Key")}"/>
      </div>

      <div class="conn-form-field conn-form-field--full" id="authValueField" style="${defaults.auth_type==="none"?"display:none":""}">
        <label>${isEdit ? "API Key / Token (leave blank to keep current)" : "API Key / Token *"}</label>
        <input name="auth_value" type="password"
          placeholder="${isEdit ? "••••••••  (unchanged)" : "Paste your key or token"}"/>
        <span class="conn-form-hint">Stored server-side only — never sent to the browser.</span>
      </div>

      <div class="conn-form-field">
        <label>Path prefix</label>
        <input name="path_prefix" placeholder="/api/v1"
          value="${escHtml(defaults.path_prefix || "")}"/>
        <span class="conn-form-hint">Prepended to every proxied path.</span>
      </div>

      <div class="conn-form-actions">
        <button type="button" class="conn-form-cancel" id="formCancel">Cancel</button>
        <button type="submit" class="conn-form-save">
          ${isEdit ? "Save changes" : "Register connector"}
        </button>
      </div>

    </form>`;

  // Show/hide auth header field based on auth type
  const authTypeSelect   = wrap.querySelector("#authTypeSelect");
  const authHeaderField  = wrap.querySelector("#authHeaderField");
  const authValueField   = wrap.querySelector("#authValueField");
  authTypeSelect.addEventListener("change", () => {
    const v = authTypeSelect.value;
    authHeaderField.style.display = (v === "bearer" || v === "none") ? "none" : "";
    authValueField.style.display  = v === "none" ? "none" : "";

    // Update auth_header placeholder for bearer
    const headerInput = authHeaderField.querySelector("input");
    headerInput.value = v === "basic" ? "Authorization" : "X-API-Key";
  });

  // Update slug hint live
  const nameInput = wrap.querySelector("[name=name]");
  const hint      = wrap.querySelector(".conn-form-hint");
  if (!isEdit) {
    nameInput.addEventListener("input", () => {
      hint.innerHTML = `Used in URL: /api/connect/<strong>${nameInput.value || "name"}</strong>/*`;
    });
  }

  // Cancel
  wrap.querySelector("#formClose").addEventListener("click",  () => { _formMode = null; render(); });
  wrap.querySelector("#formCancel").addEventListener("click", () => { _formMode = null; render(); });

  // Submit
  wrap.querySelector("#connForm").addEventListener("submit", async e => {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    // Remove empty auth_value on edit (means keep current)
    if (isEdit && !data.auth_value) delete data.auth_value;

    try {
      await saveConnector(data, isEdit ? _formMode.name : false);
      await loadConnectors();
      _formMode = null;
      render();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  return wrap;
}

// ── Boot ───────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await loadConnectors();
  } catch (e) {
    document.getElementById("conn-main").innerHTML =
      `<div style="padding:40px;text-align:center;color:#dc2626">Could not load connectors: ${escHtml(e.message)}</div>`;
    return;
  }
  render();
})();
