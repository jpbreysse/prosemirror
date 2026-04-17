/**
 * ImageBlockNodeView
 *
 * Two states:
 *   Empty  — upload button + URL paste + drag-and-drop zone
 *   Filled — renders the image with caption, alignment, resize, and remove
 *
 * Uploads go to POST /api/upload (multipart), server returns { url }.
 * The `src` attr persists the URL so the image survives Postgres round-trips.
 *
 * In read-only mode (reader.html) the toolbar is hidden.
 */

export class ImageBlockNodeView {
  constructor(node, view, getPos) {
    this.node    = node;
    this.view    = view;
    this.getPos  = getPos;
    this._uploading = false;

    this.dom = document.createElement("div");
    this.dom.className = "imgb-block";
    this._build();
  }

  // ── Patch helper ─────────────────────────────────────────────────────────────

  _patch(patch) {
    const { state, dispatch } = this.view;
    const cur = this.node.attrs;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, { ...cur, ...patch }));
  }

  // ── Is editor in read-only mode? ─────────────────────────────────────────────

  get _readonly() {
    return this.view.props.editable?.() === false;
  }

  // ── Build ─────────────────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    const { src } = this.node.attrs;
    if (src) {
      this._buildFilled();
    } else if (!this._readonly) {
      this._buildEmpty();
    } else {
      this.dom.innerHTML = `<div class="imgb-readonly-empty">📷 No image</div>`;
    }
  }

  // ── Empty / upload state ──────────────────────────────────────────────────────

  _buildEmpty() {
    const wrap = document.createElement("div");
    wrap.className = "imgb-empty";

    wrap.innerHTML = `
      <div class="imgb-drop-zone" tabindex="0">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity=".4">
          <rect x="2" y="2" width="36" height="36" rx="7" stroke="#6366f1" stroke-width="2"/>
          <path d="M13 28l5-6 4 5 3-3 5 4" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="13.5" cy="14.5" r="2.5" fill="#6366f1"/>
        </svg>
        <p class="imgb-drop-label">Drag &amp; drop an image here</p>
        <p class="imgb-drop-sub">PNG, JPG, GIF, WebP, SVG · up to 20 MB</p>
        <label class="imgb-upload-btn">
          <input type="file" accept="image/*" hidden class="imgb-file-inp"/>
          📷 Choose file
        </label>
        <div class="imgb-url-row">
          <input type="url" class="imgb-url-inp" placeholder="…or paste an image URL"/>
          <button class="imgb-url-btn">Insert</button>
        </div>
        <div class="imgb-progress" hidden>
          <div class="imgb-progress-bar"></div>
          <span class="imgb-progress-label">Uploading…</span>
        </div>
      </div>`;

    // File picker
    const fileInp = wrap.querySelector(".imgb-file-inp");
    fileInp.addEventListener("change", () => {
      if (fileInp.files[0]) this._upload(fileInp.files[0], wrap);
    });

    // URL insert
    const urlInp = wrap.querySelector(".imgb-url-inp");
    const urlBtn = wrap.querySelector(".imgb-url-btn");
    const insertUrl = () => {
      const v = urlInp.value.trim();
      if (v) this._patch({ src: v, alt: "" });
    };
    urlBtn.addEventListener("click", insertUrl);
    urlInp.addEventListener("keydown", e => { if (e.key === "Enter") insertUrl(); });

    // Drag & drop
    const dz = wrap.querySelector(".imgb-drop-zone");
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("imgb-drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("imgb-drag-over"));
    dz.addEventListener("drop", e => {
      e.preventDefault();
      dz.classList.remove("imgb-drag-over");
      const file = e.dataTransfer?.files[0];
      if (file && file.type.startsWith("image/")) this._upload(file, wrap);
    });

    this.dom.appendChild(wrap);
  }

  // ── Upload ────────────────────────────────────────────────────────────────────

  async _upload(file, wrap) {
    if (this._uploading) return;
    this._uploading = true;

    const progress = wrap.querySelector(".imgb-progress");
    const bar      = wrap.querySelector(".imgb-progress-bar");
    const label    = wrap.querySelector(".imgb-progress-label");
    if (progress) { progress.hidden = false; bar.style.width = "0%"; }

    // Fake progress tick (XHR gives real progress, fetch doesn't)
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(pct + 8, 85);
      if (bar) bar.style.width = `${pct}%`;
    }, 120);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      clearInterval(tick);
      if (bar)   bar.style.width = "100%";
      if (label) label.textContent = "Done!";

      // Small pause so user sees 100% before the block swaps
      await new Promise(r => setTimeout(r, 200));

      this._patch({ src: data.url, alt: file.name.replace(/\.[^.]+$/, "") });
    } catch (err) {
      clearInterval(tick);
      if (label) label.textContent = `Error: ${err.message}`;
      if (bar)   bar.style.background = "#ef4444";
    } finally {
      this._uploading = false;
    }
  }

  // ── Filled / display state ────────────────────────────────────────────────────

  _buildFilled() {
    const { src, alt = "", caption = "", align = "center", width = "100%" } = this.node.attrs;
    const readonly = this._readonly;

    // Wrapper controls alignment
    const outer = document.createElement("div");
    outer.className = `imgb-outer imgb-align-${align}`;

    // Image
    const imgWrap = document.createElement("div");
    imgWrap.className = "imgb-img-wrap";
    imgWrap.style.maxWidth = width;

    const img = document.createElement("img");
    img.src       = src;
    img.alt       = alt;
    img.className = "imgb-img";
    img.draggable = false;
    img.addEventListener("error", () => {
      img.style.opacity = "0.3";
      img.alt = "⚠ Image could not load";
    });
    imgWrap.appendChild(img);
    outer.appendChild(imgWrap);

    // Caption
    if (caption || !readonly) {
      const cap = document.createElement(readonly ? "p" : "input");
      cap.className = "imgb-caption";
      if (readonly) {
        cap.textContent = caption;
        if (!caption) cap.style.display = "none";
      } else {
        cap.type        = "text";
        cap.value       = caption;
        cap.placeholder = "Add a caption…";
        cap.style.maxWidth = width;
        cap.addEventListener("blur",    () => this._patch({ caption: cap.value }));
        cap.addEventListener("keydown", e => { if (e.key === "Enter") cap.blur(); });
      }
      outer.appendChild(cap);
    }

    // Toolbar (edit mode only)
    if (!readonly) {
      const bar = document.createElement("div");
      bar.className = "imgb-toolbar";

      const alignBtns = [
        { v:"left",   icon:"⬅", title:"Align left"   },
        { v:"center", icon:"⬜", title:"Center"        },
        { v:"right",  icon:"➡", title:"Align right"  },
      ];

      const sizeOpts = [
        { v:"30%",  label:"S"    },
        { v:"50%",  label:"M"    },
        { v:"75%",  label:"L"    },
        { v:"100%", label:"Full" },
      ];

      bar.innerHTML = `
        <span class="imgb-bar-group">
          ${alignBtns.map(a => `
            <button class="imgb-bar-btn ${align===a.v?"imgb-bar-btn--on":""}"
              data-align="${a.v}" title="${a.title}">${a.icon}</button>`).join("")}
        </span>
        <span class="imgb-bar-sep"></span>
        <span class="imgb-bar-group">
          ${sizeOpts.map(s => `
            <button class="imgb-bar-btn ${width===s.v?"imgb-bar-btn--on":""}"
              data-size="${s.v}" title="Width ${s.v}">${s.label}</button>`).join("")}
        </span>
        <span class="imgb-bar-sep"></span>
        <button class="imgb-bar-btn imgb-bar-btn--del" title="Remove image">🗑 Remove</button>`;

      bar.querySelectorAll("[data-align]").forEach(btn => {
        btn.addEventListener("click", () => this._patch({ align: btn.dataset.align }));
      });
      bar.querySelectorAll("[data-size]").forEach(btn => {
        btn.addEventListener("click", () => this._patch({ width: btn.dataset.size }));
      });
      bar.querySelector(".imgb-bar-btn--del").addEventListener("click", () => {
        this._patch({ src: "", alt: "", caption: "", align: "center", width: "100%" });
      });

      outer.appendChild(bar);
    }

    this.dom.appendChild(outer);
  }

  // ── ProseMirror NodeView interface ────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._build();
    return true;
  }
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}
