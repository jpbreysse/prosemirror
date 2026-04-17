/**
 * extensions/fhir/nodeView.js
 *
 * A ProseMirror NodeView that fetches and renders a FHIR R4 resource card.
 *
 * Supported resource types:
 *   Patient             — name, birthDate, gender, identifier, address
 *   Observation         — code, value, status, effectiveDateTime
 *   MedicationStatement — medication, status, dosage, subject
 *
 * Data flow:
 *   1. User inserts the block (empty "idle" state) → see fetch form
 *   2. User picks resourceType + resourceId → clicks Fetch
 *   3. NodeView dispatches status="loading" attr → shows spinner
 *   4. fetch() calls FHIR server → on success dispatches resource JSON
 *   5. render() picks the right renderer and builds the card DOM
 */

// ── DOM micro-helpers ────────────────────────────────────────────────────────

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.flat(Infinity).filter(Boolean).forEach(c =>
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  );
  return e;
}

function btn(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("mousedown", e => e.preventDefault());
  b.addEventListener("click",     e => { e.stopPropagation(); onClick(e); });
  return b;
}

function inp(cls, value, placeholder = "") {
  const i = document.createElement("input");
  i.className   = cls;
  i.type        = "text";
  i.value       = value;
  i.placeholder = placeholder;
  i.addEventListener("mousedown", e => e.stopPropagation());
  i.addEventListener("click",     e => e.stopPropagation());
  return i;
}

function row(label, value) {
  return el("div", "fhir-row",
    el("span", "fhir-row-label", label),
    el("span", "fhir-row-value", value ?? "—"),
  );
}

// ── Resource type metadata ───────────────────────────────────────────────────

const META = {
  Patient:             { icon: "👤", color: "#3b82f6", bg: "#eff6ff", label: "Patient" },
  Observation:         { icon: "🔬", color: "#8b5cf6", bg: "#f5f3ff", label: "Observation" },
  MedicationStatement: { icon: "💊", color: "#22c55e", bg: "#f0fdf4", label: "Medication" },
};

const DEFAULT_META = { icon: "🏥", color: "#6366f1", bg: "#eef2ff", label: "Resource" };

// ── FHIR field helpers ───────────────────────────────────────────────────────

function humanName(nameArr = []) {
  if (!nameArr.length) return "Unknown";
  const n = nameArr[0];
  const given  = (n.given  || []).join(" ");
  const family = n.family || "";
  return [given, family].filter(Boolean).join(" ") || n.text || "Unknown";
}

function formatDate(str) {
  if (!str) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(str));
  } catch { return str; }
}

function gender(str) {
  const map = { male: "Male", female: "Female", other: "Other", unknown: "Unknown" };
  return map[str] || str || "Unknown";
}

// ── Per-type renderers ────────────────────────────────────────────────────────

function renderPatient(r) {
  const rows = [
    row("Name",      humanName(r.name)),
    row("Born",      formatDate(r.birthDate)),
    row("Gender",    gender(r.gender)),
    row("ID",        (r.identifier?.[0]?.value) || r.id),
  ];
  if (r.address?.length) {
    const a = r.address[0];
    const addr = [a.line?.[0], a.city, a.country].filter(Boolean).join(", ");
    rows.push(row("Address", addr));
  }
  return rows;
}

function renderObservation(r) {
  const code  = r.code?.coding?.[0]?.display || r.code?.text || "—";
  let value   = "—";
  if (r.valueQuantity) {
    value = `${r.valueQuantity.value} ${r.valueQuantity.unit || ""}`.trim();
  } else if (r.valueString) {
    value = r.valueString;
  } else if (r.valueCodeableConcept) {
    value = r.valueCodeableConcept.text || r.valueCodeableConcept.coding?.[0]?.display || "—";
  }
  return [
    row("Code",      code),
    row("Value",     value),
    row("Status",    r.status),
    row("Date",      formatDate(r.effectiveDateTime || r.issued)),
    row("Subject",   r.subject?.reference || "—"),
  ];
}

function renderMedication(r) {
  const med = r.medicationCodeableConcept?.text
           || r.medicationCodeableConcept?.coding?.[0]?.display
           || r.medicationReference?.display
           || "—";
  const dosage = r.dosage?.[0]?.text || r.dosage?.[0]?.doseAndRate?.[0]?.doseQuantity?.value || "—";
  return [
    row("Medication", med),
    row("Status",     r.status),
    row("Dosage",     dosage),
    row("Subject",    r.subject?.reference || "—"),
    row("Date",       formatDate(r.effectiveDateTime || r.dateAsserted)),
  ];
}

function renderResource(resource) {
  switch (resource.resourceType) {
    case "Patient":             return renderPatient(resource);
    case "Observation":         return renderObservation(resource);
    case "MedicationStatement": return renderMedication(resource);
    default:
      return [row("ID", resource.id), row("Type", resource.resourceType)];
  }
}

// ── NodeView ─────────────────────────────────────────────────────────────────

export class FhirNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = el("div", "fhir-node");
    this.dom.contentEditable = "false";

    this._render(node.attrs);
  }

  // ── Main render switch ────────────────────────────────────────────

  _render(attrs) {
    this.dom.innerHTML = "";
    const meta = META[attrs.resourceType] || DEFAULT_META;

    switch (attrs.status) {
      case "idle":    return this._renderIdle(attrs, meta);
      case "loading": return this._renderLoading(meta);
      case "loaded":  return this._renderLoaded(attrs, meta);
      case "error":   return this._renderError(attrs, meta);
    }
  }

  // ── Idle — fetch form ─────────────────────────────────────────────

  _renderIdle(attrs, meta) {
    const card = el("div", "fhir-card fhir-card--idle");
    card.style.setProperty("--fhir-color", meta.color);
    card.style.setProperty("--fhir-bg",    meta.bg);

    // Header
    card.appendChild(
      el("div", "fhir-header",
        el("span", "fhir-icon", meta.icon),
        el("div", "fhir-header-text",
          el("span", "fhir-type-label", "Insert FHIR Resource"),
          el("span", "fhir-subtitle", "Fetch from a FHIR R4 server"),
        ),
      )
    );

    // Form
    const form = el("div", "fhir-form");

    // Resource type selector
    const typeWrap = el("div", "fhir-field");
    typeWrap.appendChild(el("label", "fhir-label", "Resource Type"));
    const sel = document.createElement("select");
    sel.className = "fhir-select";
    ["Patient", "Observation", "MedicationStatement"].forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = `${META[t].icon}  ${t}`;
      if (t === attrs.resourceType) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("mousedown", e => e.stopPropagation());
    sel.addEventListener("change",    e => e.stopPropagation());
    typeWrap.appendChild(sel);
    form.appendChild(typeWrap);

    // Resource ID
    const idWrap = el("div", "fhir-field");
    idWrap.appendChild(el("label", "fhir-label", "Resource ID"));
    const idInp = inp("fhir-input", attrs.resourceId, "e.g. example, pat-001…");
    idWrap.appendChild(idInp);
    form.appendChild(idWrap);

    // Server URL
    const srvWrap = el("div", "fhir-field");
    srvWrap.appendChild(el("label", "fhir-label", "FHIR Server"));
    const srvInp = inp("fhir-input fhir-input--wide", attrs.serverUrl, "https://hapi.fhir.org/baseR4");
    srvWrap.appendChild(srvInp);
    form.appendChild(srvWrap);

    // Fetch button
    const fetchBtn = btn("fhir-fetch-btn", `${meta.icon} Fetch`, () => {
      this._fetch(sel.value, idInp.value.trim(), srvInp.value.trim());
    });
    form.appendChild(fetchBtn);

    // Quick examples
    const examples = el("div", "fhir-examples",
      el("span", "fhir-examples-label", "Try: "),
    );
    const exampleList = [
      { type: "Patient",             id: "example",        label: "Patient/example" },
      { type: "Observation",         id: "example",        label: "Observation/example" },
      { type: "MedicationStatement", id: "example",        label: "Medication/example" },
    ];
    exampleList.forEach(ex => {
      const link = el("button", "fhir-example-link", ex.label);
      link.type = "button";
      link.addEventListener("mousedown", e => e.preventDefault());
      link.addEventListener("click", e => {
        e.stopPropagation();
        this._fetch(ex.type, ex.id, attrs.serverUrl);
      });
      examples.appendChild(link);
    });
    form.appendChild(examples);

    card.appendChild(form);
    this.dom.appendChild(card);
  }

  // ── Loading spinner ───────────────────────────────────────────────

  _renderLoading(meta) {
    const card = el("div", "fhir-card fhir-card--loading");
    card.style.setProperty("--fhir-color", meta.color);
    card.style.setProperty("--fhir-bg",    meta.bg);

    card.appendChild(
      el("div", "fhir-loading",
        el("div", "fhir-spinner"),
        el("span", null, `Fetching ${meta.label}…`),
      )
    );
    this.dom.appendChild(card);
  }

  // ── Loaded — resource card ────────────────────────────────────────

  _renderLoaded(attrs, meta) {
    const r    = attrs.resource;
    const card = el("div", "fhir-card fhir-card--loaded");
    card.style.setProperty("--fhir-color", meta.color);
    card.style.setProperty("--fhir-bg",    meta.bg);

    // Header
    const refetchBtn = btn("fhir-refetch-btn", "↺", () => {
      this._updateAttrs({ status: "idle", resource: null });
    });
    refetchBtn.title = "Change resource";

    card.appendChild(
      el("div", "fhir-header",
        el("span", "fhir-icon", meta.icon),
        el("div", "fhir-header-text",
          el("span", "fhir-type-label", meta.label),
          el("span", "fhir-subtitle",   `${attrs.serverUrl} / ${r.resourceType} / ${r.id}`),
        ),
        refetchBtn,
      )
    );

    // Resource badge
    const badge = el("div", "fhir-badge", `${r.resourceType} · ${r.id}`);
    badge.style.background = meta.color;
    card.appendChild(badge);

    // Fields
    const fields = el("div", "fhir-fields");
    renderResource(r).forEach(rowEl => fields.appendChild(rowEl));
    card.appendChild(fields);

    // Raw JSON toggle
    const rawBtn = btn("fhir-raw-btn", "{ } View raw JSON", () => {
      rawPre.style.display = rawPre.style.display === "none" ? "block" : "none";
      rawBtn.textContent   = rawPre.style.display === "none" ? "{ } View raw JSON" : "{ } Hide JSON";
    });
    const rawPre = document.createElement("pre");
    rawPre.className    = "fhir-raw";
    rawPre.style.display = "none";
    rawPre.textContent  = JSON.stringify(r, null, 2);
    card.appendChild(rawBtn);
    card.appendChild(rawPre);

    this.dom.appendChild(card);
  }

  // ── Error state ───────────────────────────────────────────────────

  _renderError(attrs, meta) {
    const card = el("div", "fhir-card fhir-card--error");
    card.style.setProperty("--fhir-color", meta.color);

    card.appendChild(
      el("div", "fhir-error",
        el("span", "fhir-error-icon", "⚠️"),
        el("div", null,
          el("strong", null, "Could not fetch resource"),
          el("p", "fhir-error-msg", attrs.error),
        ),
      )
    );

    const retryBtn = btn("fhir-retry-btn", "Try again", () => {
      this._updateAttrs({ status: "idle", error: "" });
    });
    card.appendChild(retryBtn);

    this.dom.appendChild(card);
  }

  // ── Fetch ─────────────────────────────────────────────────────────

  async _fetch(resourceType, resourceId, serverUrl) {
    if (!resourceId) return;

    // Immediately mark as loading in the document
    this._updateAttrs({ resourceType, resourceId, serverUrl, status: "loading", resource: null, error: "" });

    const url = `${serverUrl.replace(/\/$/, "")}/${resourceType}/${resourceId}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/fhir+json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      }
      const resource = await res.json();
      if (resource.resourceType === "OperationOutcome") {
        const issue = resource.issue?.[0]?.diagnostics || "Resource not found";
        throw new Error(issue);
      }
      this._updateAttrs({ status: "loaded", resource });
    } catch (err) {
      this._updateAttrs({ status: "error", error: err.message });
    }
  }

  // ── ProseMirror integration ───────────────────────────────────────

  _updateAttrs(patch) {
    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...patch })
    );
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._render(node.attrs);
    return true;
  }

  destroy() {}

  stopEvent(event) {
    if (event.type === "keydown") {
      const k = event.key;
      if (k === "Tab" || k === "Escape") return false;
    }
    return true;
  }

  ignoreMutation() { return true; }
}
