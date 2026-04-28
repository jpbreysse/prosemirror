import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "inherit",
});

let _uid = 0;
function uid() { return `mermaid-render-${++_uid}`; }

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

export class MermaidBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._editing = false;

    this.dom = document.createElement("div");
    this.dom.className = "mermaid-block";
    this._build();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    if (this._editing) {
      this._renderEditor();
    } else {
      this._renderPreview();
    }
  }

  async _renderPreview() {
    const code = this.node.attrs.code || "";
    this.dom.innerHTML = `<div class="mermaid-loading">Rendering diagram…</div>`;

    try {
      const id  = uid();
      const { svg } = await mermaid.render(id, code);

      this.dom.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "mermaid-preview";
      wrap.title = "Click to edit";
      wrap.innerHTML = svg;
      this.dom.appendChild(wrap);

      const editBtn = document.createElement("button");
      editBtn.className = "mermaid-edit-btn";
      editBtn.textContent = "Edit";
      editBtn.title = "Edit diagram source";
      editBtn.addEventListener("click", e => { e.stopPropagation(); this._startEditing(); });
      this.dom.appendChild(editBtn);

      wrap.addEventListener("dblclick", () => this._startEditing());
    } catch (err) {
      // Clean up any leftover mermaid error DOM
      document.getElementById(`d${uid()}`)?.remove();

      this.dom.innerHTML = "";
      const errBox = document.createElement("div");
      errBox.className = "mermaid-error";
      errBox.innerHTML = `<span class="mermaid-error-icon">⚠️</span> ${escHtml(err.message)}`;
      this.dom.appendChild(errBox);

      const editBtn = document.createElement("button");
      editBtn.className = "mermaid-edit-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", e => { e.stopPropagation(); this._startEditing(); });
      this.dom.appendChild(editBtn);
    }
  }

  _renderEditor() {
    const code = this.node.attrs.code || "";

    const wrap = document.createElement("div");
    wrap.className = "mermaid-editor";

    const header = document.createElement("div");
    header.className = "mermaid-editor-header";
    header.innerHTML = `
      <span class="mermaid-editor-label">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M4 4h6M4 7h4M4 10h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        Mermaid diagram
      </span>
      <div class="mermaid-editor-actions">
        <button class="mermaid-btn mermaid-btn--render" id="_mmdRender">Render</button>
        <button class="mermaid-btn mermaid-btn--cancel" id="_mmdCancel">Cancel</button>
      </div>`;
    wrap.appendChild(header);

    const textarea = document.createElement("textarea");
    textarea.className = "mermaid-textarea";
    textarea.value = code;
    textarea.rows = Math.max(6, code.split("\n").length + 1);
    textarea.spellcheck = false;
    wrap.appendChild(textarea);

    this.dom.appendChild(wrap);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    wrap.querySelector("#_mmdRender").addEventListener("click", () => {
      this._commitAndPreview(textarea.value);
    });
    wrap.querySelector("#_mmdCancel").addEventListener("click", () => {
      this._editing = false;
      this._build();
    });
    textarea.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); this._editing = false; this._build(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); this._commitAndPreview(textarea.value); }
    });
  }

  _startEditing() {
    this._editing = true;
    this._build();
  }

  _commitAndPreview(code) {
    const trimmed = code.trim();
    if (trimmed !== this.node.attrs.code) {
      const tr = this.view.state.tr.setNodeMarkup(
        this.getPos(), null, { ...this.node.attrs, code: trimmed }
      );
      this.view.dispatch(tr);
    }
    this._editing = false;
    this._build();
  }

  // ── ProseMirror hooks ─────────────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this._editing) this._renderPreview();
    return true;
  }

  stopEvent(e) {
    // Let the editor handle clicks outside our block
    if (this._editing) return true;
    return e.target?.closest(".mermaid-edit-btn") != null;
  }

  ignoreMutation() { return true; }
  destroy() {}
}
