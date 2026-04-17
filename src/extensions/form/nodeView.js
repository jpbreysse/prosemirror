/**
 * extensions/form/nodeView.js
 *
 * A ProseMirror NodeView for an embeddable form with two modes:
 *
 *   EDIT MODE  — author view
 *     • Edit the form title and description inline
 *     • Add fields: text | email | number | tel | date | textarea | select
 *     • Edit each field's label, placeholder, required flag, and options
 *     • Delete fields
 *     • Switch to Fill mode to preview
 *
 *   FILL MODE  — reader view
 *     • Renders real <input>, <textarea>, <select> elements
 *     • Validates required fields
 *     • On submit: logs the JSON response to console and shows a
 *       success confirmation inside the block (no page reload)
 *     • "Submit another response" resets the form
 *
 * Everything is stored in ProseMirror attrs so the full form definition
 * (title, fields, mode) is part of the document and is undo-able.
 */

// ── Unique ID helper ─────────────────────────────────────────────────────────

let _seq = 0;
function uid() { return `f${Date.now()}_${++_seq}`; }

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

function inp(cls, value, type = "text", placeholder = "") {
  const i = document.createElement("input");
  i.className   = cls;
  i.type        = type;
  i.value       = value ?? "";
  i.placeholder = placeholder;
  i.addEventListener("mousedown", e => e.stopPropagation());
  i.addEventListener("click",     e => e.stopPropagation());
  return i;
}

function stopAll(el) {
  ["mousedown","click","keydown"].forEach(ev =>
    el.addEventListener(ev, e => e.stopPropagation())
  );
  return el;
}

// ── Field type definitions ───────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: "text",     label: "Text" },
  { value: "email",    label: "Email" },
  { value: "number",   label: "Number" },
  { value: "tel",      label: "Phone" },
  { value: "date",     label: "Date" },
  { value: "textarea", label: "Long text" },
  { value: "select",   label: "Dropdown" },
  { value: "checkbox", label: "Checkboxes" },
];

const FIELD_ICONS = {
  text: "Aa",  email: "✉",  number: "#",
  tel: "📞",   date: "📅",  textarea: "¶",
  select: "▾", checkbox: "☑",
};

// ── NodeView ─────────────────────────────────────────────────────────────────

export class FormNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._submitted = false;
    this._inputRefs = {}; // fieldId → input element (in fill mode)

    this.dom = el("div", "form-node");
    this.dom.contentEditable = "false";
    this._render(node.attrs);
  }

  // ── Top-level render switch ───────────────────────────────────────

  _render(attrs) {
    this.dom.innerHTML = "";
    this._inputRefs = {};

    if (this._submitted && attrs.mode === "fill") {
      this._renderSuccess(attrs);
    } else if (attrs.mode === "fill") {
      this._renderFill(attrs);
    } else {
      this._renderEdit(attrs);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // EDIT MODE
  // ══════════════════════════════════════════════════════════════════

  _renderEdit(attrs) {
    const wrap = el("div", "form-edit");

    // ── Top bar ───────────────────────────────────────────────────
    const topBar = el("div", "form-topbar");

    const titleInp = inp("form-title-input", attrs.title, "text", "Form title…");
    titleInp.addEventListener("input", () =>
      this._updateAttrs({ title: titleInp.value })
    );

    const previewBtn = btn("form-mode-btn form-mode-btn--fill", "▶ Preview", () =>
      this._updateAttrs({ mode: "fill" })
    );

    topBar.append(titleInp, previewBtn);
    wrap.appendChild(topBar);

    // ── Description ───────────────────────────────────────────────
    const descInp = document.createElement("textarea");
    descInp.className   = "form-desc-input";
    descInp.placeholder = "Form description (optional)…";
    descInp.value       = attrs.description;
    descInp.rows        = 2;
    stopAll(descInp);
    descInp.addEventListener("input", () =>
      this._updateAttrs({ description: descInp.value })
    );
    wrap.appendChild(descInp);

    // ── Divider ───────────────────────────────────────────────────
    wrap.appendChild(el("div", "form-divider"));

    // ── Field list ────────────────────────────────────────────────
    const fieldList = el("div", "form-field-list");
    attrs.fields.forEach((field, idx) => {
      fieldList.appendChild(this._buildEditField(field, idx, attrs));
    });
    wrap.appendChild(fieldList);

    // ── Add field strip ───────────────────────────────────────────
    const addStrip = el("div", "form-add-strip");
    addStrip.appendChild(el("span", "form-add-label", "+ Add field:"));

    FIELD_TYPES.forEach(ft => {
      const b = btn("form-add-type-btn", `${FIELD_ICONS[ft.value]} ${ft.label}`, () => {
        const newField = {
          id: uid(), type: ft.value,
          label: ft.label, placeholder: "",
          required: false, options: ft.value === "select" || ft.value === "checkbox"
            ? ["Option 1", "Option 2"] : [],
        };
        this._updateAttrs({ fields: [...attrs.fields, newField] });
      });
      addStrip.appendChild(b);
    });

    wrap.appendChild(addStrip);

    // ── Submit label editor ───────────────────────────────────────
    const submitRow = el("div", "form-submit-row-edit");
    submitRow.appendChild(el("span", "form-submit-row-label", "Submit button label:"));
    const submitInp = inp("form-submit-label-input", attrs.submitLabel, "text", "Submit");
    submitInp.addEventListener("input", () =>
      this._updateAttrs({ submitLabel: submitInp.value })
    );
    submitRow.appendChild(submitInp);
    wrap.appendChild(submitRow);

    this.dom.appendChild(wrap);
  }

  _buildEditField(field, idx, attrs) {
    const row = el("div", "form-edit-field");
    row.dataset.fieldId = field.id;

    // Drag handle (visual only for now)
    row.appendChild(el("span", "form-field-handle", "⠿"));

    // Type badge
    const typeBadge = el("span", "form-field-type-badge", FIELD_ICONS[field.type]);
    typeBadge.title = field.type;
    row.appendChild(typeBadge);

    // Field content
    const content = el("div", "form-edit-field-content");

    // Label + required toggle on same row
    const labelRow = el("div", "form-edit-field-labelrow");
    const labelInp = inp("form-field-label-input", field.label, "text", "Field label…");
    labelInp.addEventListener("input", () => {
      this._patchField(field.id, { label: labelInp.value }, attrs);
    });
    labelRow.appendChild(labelInp);

    const reqLabel = el("label", "form-field-req-label");
    const reqCheck = document.createElement("input");
    reqCheck.type    = "checkbox";
    reqCheck.checked = field.required;
    reqCheck.className = "form-field-req-check";
    stopAll(reqCheck);
    reqCheck.addEventListener("change", () => {
      this._patchField(field.id, { required: reqCheck.checked }, attrs);
    });
    reqLabel.append(reqCheck, " Required");
    stopAll(reqLabel);
    labelRow.appendChild(reqLabel);
    content.appendChild(labelRow);

    // Placeholder (not for checkbox)
    if (field.type !== "checkbox") {
      const phInp = inp("form-field-placeholder-input", field.placeholder, "text", "Placeholder text…");
      phInp.addEventListener("input", () => {
        this._patchField(field.id, { placeholder: phInp.value }, attrs);
      });
      content.appendChild(phInp);
    }

    // Options editor (select / checkbox)
    if (field.type === "select" || field.type === "checkbox") {
      const optWrap = el("div", "form-options-wrap");
      optWrap.appendChild(el("span", "form-options-label", "Options (one per line):"));
      const optArea = document.createElement("textarea");
      optArea.className   = "form-options-textarea";
      optArea.value       = (field.options || []).join("\n");
      optArea.rows        = 3;
      optArea.placeholder = "Option 1\nOption 2\nOption 3";
      stopAll(optArea);
      optArea.addEventListener("input", () => {
        const options = optArea.value.split("\n").map(s => s.trim()).filter(Boolean);
        this._patchField(field.id, { options }, attrs);
      });
      optWrap.appendChild(optArea);
      content.appendChild(optWrap);
    }

    row.appendChild(content);

    // Action buttons
    const actions = el("div", "form-edit-field-actions");

    // Move up / down
    if (idx > 0) {
      actions.appendChild(btn("form-field-move-btn", "↑", () => {
        const f = [...attrs.fields];
        [f[idx - 1], f[idx]] = [f[idx], f[idx - 1]];
        this._updateAttrs({ fields: f });
      }));
    }
    if (idx < attrs.fields.length - 1) {
      actions.appendChild(btn("form-field-move-btn", "↓", () => {
        const f = [...attrs.fields];
        [f[idx], f[idx + 1]] = [f[idx + 1], f[idx]];
        this._updateAttrs({ fields: f });
      }));
    }

    actions.appendChild(btn("form-field-delete-btn", "✕", () => {
      this._updateAttrs({ fields: attrs.fields.filter(f => f.id !== field.id) });
    }));

    row.appendChild(actions);
    return row;
  }

  // ══════════════════════════════════════════════════════════════════
  // FILL MODE
  // ══════════════════════════════════════════════════════════════════

  _renderFill(attrs) {
    const wrap = el("div", "form-fill");

    // ── Header ────────────────────────────────────────────────────
    const header = el("div", "form-fill-header");
    header.appendChild(el("h3", "form-fill-title", attrs.title));
    if (attrs.description) {
      header.appendChild(el("p", "form-fill-desc", attrs.description));
    }
    const editBtn = btn("form-mode-btn form-mode-btn--edit", "✎ Edit", () => {
      this._submitted = false;
      this._updateAttrs({ mode: "edit" });
    });
    header.appendChild(editBtn);
    wrap.appendChild(header);

    wrap.appendChild(el("div", "form-divider"));

    // ── Fields ────────────────────────────────────────────────────
    const fieldWrap = el("div", "form-fill-fields");
    attrs.fields.forEach(field => {
      fieldWrap.appendChild(this._buildFillField(field));
    });
    wrap.appendChild(fieldWrap);

    // ── Error area ────────────────────────────────────────────────
    this._errorEl = el("div", "form-error");
    this._errorEl.style.display = "none";
    wrap.appendChild(this._errorEl);

    // ── Submit row ────────────────────────────────────────────────
    const submitRow = el("div", "form-fill-submit-row");
    const submitBtn = btn("form-submit-btn", attrs.submitLabel || "Submit", () => {
      this._handleSubmit(attrs);
    });
    submitRow.appendChild(submitBtn);
    wrap.appendChild(submitRow);

    this.dom.appendChild(wrap);
  }

  _buildFillField(field) {
    const group = el("div", "form-fill-group");

    const label = el("label", "form-fill-label",
      field.label,
      field.required ? el("span", "form-required-star", " *") : null,
    );
    group.appendChild(label);

    let control;

    if (field.type === "textarea") {
      control = document.createElement("textarea");
      control.className   = "form-fill-textarea";
      control.placeholder = field.placeholder || "";
      control.rows        = 4;
      stopAll(control);

    } else if (field.type === "select") {
      control = document.createElement("select");
      control.className = "form-fill-select";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = field.placeholder || "Select an option…";
      empty.disabled = true;
      empty.selected = true;
      control.appendChild(empty);
      (field.options || []).forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        control.appendChild(o);
      });
      stopAll(control);

    } else if (field.type === "checkbox") {
      control = el("div", "form-fill-checkbox-group");
      (field.options || []).forEach(opt => {
        const lbl = el("label", "form-fill-checkbox-label");
        const cb  = document.createElement("input");
        cb.type      = "checkbox";
        cb.value     = opt;
        cb.className = "form-fill-checkbox";
        stopAll(cb);
        lbl.append(cb, ` ${opt}`);
        stopAll(lbl);
        control.appendChild(lbl);
      });

    } else {
      control = document.createElement("input");
      control.type        = field.type;
      control.className   = "form-fill-input";
      control.placeholder = field.placeholder || "";
      stopAll(control);
    }

    group.appendChild(control);
    this._inputRefs[field.id] = control;
    return group;
  }

  // ── Submit handler ────────────────────────────────────────────────

  _handleSubmit(attrs) {
    const response = {};
    let firstError = null;

    for (const field of attrs.fields) {
      const ctrl = this._inputRefs[field.id];
      if (!ctrl) continue;

      let value;
      if (field.type === "checkbox") {
        value = [...ctrl.querySelectorAll("input:checked")].map(c => c.value);
      } else {
        value = ctrl.value;
      }

      if (field.required) {
        const empty = Array.isArray(value) ? value.length === 0 : !value.trim();
        if (empty) {
          firstError = firstError || `"${field.label}" is required.`;
          ctrl.classList?.add("form-fill-input--error");
          continue;
        }
      }
      ctrl.classList?.remove("form-fill-input--error");
      response[field.label] = value;
    }

    if (firstError) {
      this._errorEl.textContent  = `⚠ ${firstError}`;
      this._errorEl.style.display = "block";
      return;
    }

    this._errorEl.style.display = "none";
    console.info("[Form response]", response);

    this._submitted = true;
    this._render(attrs); // switch to success state
  }

  // ── Success state ─────────────────────────────────────────────────

  _renderSuccess(attrs) {
    const wrap = el("div", "form-success");
    wrap.appendChild(el("div", "form-success-icon", "✓"));
    wrap.appendChild(el("h3", "form-success-title", "Response submitted!"));
    wrap.appendChild(el("p", "form-success-msg", "Thank you for filling out this form."));
    const again = btn("form-again-btn", "Submit another response", () => {
      this._submitted = false;
      this._render(attrs);
    });
    wrap.appendChild(again);
    this.dom.appendChild(wrap);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _patchField(id, patch, attrs) {
    const fields = attrs.fields.map(f => f.id === id ? { ...f, ...patch } : f);
    this._updateAttrs({ fields });
  }

  _updateAttrs(patch) {
    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...patch })
    );
  }

  // ── ProseMirror NodeView interface ────────────────────────────────

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
      if (k === "Escape") return false;
    }
    return true;
  }

  ignoreMutation() { return true; }
}
