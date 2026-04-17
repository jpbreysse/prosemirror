/**
 * MarkdownBlockNodeView
 *
 * A two-mode block:
 *   Preview — renders the markdown content as styled HTML (via marked)
 *   Edit    — raw textarea with live word/line counter
 *
 * The raw markdown string is stored in the `content` attr so it persists
 * to Postgres with the rest of the document.
 *
 * Switching between modes is local UI state (not stored in attrs).
 * The textarea patches on blur / Ctrl+Enter to avoid re-rendering every keystroke.
 */

import { marked } from "marked";

// ── Configure marked ──────────────────────────────────────────────────────────
marked.setOptions({
  breaks: true,      // single newline → <br>
  gfm:    true,      // GitHub Flavoured Markdown (tables, strikethrough, etc.)
});

// Custom renderer — opens links in new tab, wraps code blocks with copy button
const renderer = new marked.Renderer();

renderer.link = ({ href, title, text }) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ""}>${text}</a>`;

renderer.code = ({ text, lang }) => {
  const langLabel = lang ? `<span class="mdv-code-lang">${lang}</span>` : "";
  const escaped   = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `
    <div class="mdv-code-wrap">
      ${langLabel}
      <button class="mdv-copy-btn" data-code="${escaped.replace(/"/g,"&quot;")}">Copy</button>
      <pre><code>${escaped}</code></pre>
    </div>`;
};

marked.use({ renderer });

// ── NodeView ──────────────────────────────────────────────────────────────────
export class MarkdownBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._mode  = "preview";   // "preview" | "edit"

    this.dom = document.createElement("div");
    this.dom.className = "mdv-block";
    this._build();
  }

  _patch(patch) {
    const { state, dispatch } = this.view;
    const cur      = this.node.attrs;
    const resolved = typeof patch === "function" ? patch(cur) : patch;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...cur, ...resolved }));
  }

  _build() {
    this.dom.innerHTML = "";
    this._renderToolbar();
    this._renderBody();
  }

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  _renderToolbar() {
    const { filename } = this.node.attrs;
    const bar = document.createElement("div");
    bar.className = "mdv-toolbar";
    bar.innerHTML = `
      <div class="mdv-toolbar-left">
        <svg class="mdv-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2.5" stroke="#6366f1" stroke-width="1.4"/>
          <path d="M4 5h8M4 8h8M4 11h5" stroke="#6366f1" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <input class="mdv-filename" type="text" value="${ea(filename)}"
          placeholder="untitled.md" spellcheck="false"/>
      </div>
      <div class="mdv-tabs">
        <button class="mdv-tab ${this._mode === "edit"    ? "mdv-tab--active" : ""}" data-mode="edit">Edit</button>
        <button class="mdv-tab ${this._mode === "preview" ? "mdv-tab--active" : ""}" data-mode="preview">Preview</button>
      </div>`;

    // Filename patch on blur / Enter
    const fnInput = bar.querySelector(".mdv-filename");
    fnInput.addEventListener("blur", () => {
      if (fnInput.value !== this.node.attrs.filename)
        this._patch({ filename: fnInput.value });
    });
    fnInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); fnInput.blur(); }
    });

    // Mode toggle — switch without rebuilding the whole block
    bar.querySelectorAll(".mdv-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.mode === this._mode) return;
        this._mode = btn.dataset.mode;
        bar.querySelectorAll(".mdv-tab").forEach(b =>
          b.classList.toggle("mdv-tab--active", b.dataset.mode === this._mode)
        );
        this._renderBody();
      });
    });

    this.dom.appendChild(bar);
  }

  // ── Body (swaps between edit / preview) ─────────────────────────────────────
  _renderBody() {
    // Remove old body if present
    const old = this.dom.querySelector(".mdv-body");
    if (old) old.remove();

    const body = document.createElement("div");
    body.className = "mdv-body";

    if (this._mode === "edit") {
      this._renderEdit(body);
    } else {
      this._renderPreview(body);
    }

    this.dom.appendChild(body);
  }

  _renderEdit(body) {
    const { content } = this.node.attrs;
    body.innerHTML = `
      <textarea class="mdv-textarea" spellcheck="false" placeholder="Type your markdown here…">${eh(content)}</textarea>
      <div class="mdv-edit-footer">
        <span class="mdv-stats"></span>
        <span class="mdv-hint">Ctrl+Enter to save · Esc to preview</span>
      </div>`;

    const ta    = body.querySelector(".mdv-textarea");
    const stats = body.querySelector(".mdv-stats");

    const updateStats = () => {
      const lines = ta.value.split("\n").length;
      const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      stats.textContent = `${words} words · ${lines} lines`;
    };
    updateStats();

    ta.addEventListener("input",   updateStats);
    ta.addEventListener("blur",    () => { if (ta.value !== this.node.attrs.content) this._patch({ content: ta.value }); });
    ta.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        this._patch({ content: ta.value });
        this._mode = "preview";
        this._build();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this._patch({ content: ta.value });
        this._mode = "preview";
        this._build();
      }
      // Tab → insert 2 spaces instead of leaving textarea
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
        updateStats();
      }
    });

    // Focus at end of content
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  _renderPreview(body) {
    const { content } = this.node.attrs;

    if (!content.trim()) {
      body.innerHTML = `
        <div class="mdv-empty">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity=".35">
            <rect x="2" y="2" width="28" height="28" rx="5" stroke="#6366f1" stroke-width="2"/>
            <path d="M8 11h16M8 16h16M8 21h10" stroke="#6366f1" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>No content yet. Click <strong>Edit</strong> to start writing.</p>
        </div>`;
      return;
    }

    const preview = document.createElement("div");
    preview.className = "mdv-preview";
    preview.innerHTML = marked.parse(content);

    // Wire up copy buttons
    preview.querySelectorAll(".mdv-copy-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code
          .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"');
        navigator.clipboard?.writeText(code).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy"; }, 1500);
        });
      });
    });

    body.appendChild(preview);
  }

  // ── ProseMirror NodeView interface ───────────────────────────────────────────
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Don't rebuild if we're in edit mode (user is typing) — just update the preview
    if (this._mode === "preview") this._build();
    return true;
  }
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function eh(s)  { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function ea(s)  { return String(s ?? "").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
