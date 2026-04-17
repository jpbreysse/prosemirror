/**
 * MoleculeBlockNodeView
 *
 * Renders a 2D chemical structure from a SMILES string using SmilesDrawer.
 * The library is loaded on demand from CDN the first time a molecule block
 * is created.
 *
 * Two modes:
 *   Edit  — SMILES input, preset palette, live SVG preview, caption field
 *   Read  — clean SVG rendering + caption (reader.html or _readonly)
 *
 * Stored attrs: smiles, caption, theme ("light" | "dark"), width ("100%" etc.)
 */

// ── Lazy CDN loader ───────────────────────────────────────────────────────────

let _sdPromise = null;

function loadSmilesDrawer() {
  if (_sdPromise) return _sdPromise;
  _sdPromise = new Promise((resolve, reject) => {
    if (window.SmilesDrawer) { resolve(window.SmilesDrawer); return; }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/smiles-drawer@2.2.1/dist/smiles-drawer.min.js";
    script.crossOrigin = "anonymous";
    script.onload  = () => resolve(window.SmilesDrawer);
    script.onerror = () => reject(new Error("Failed to load SmilesDrawer"));
    document.head.appendChild(script);
  });
  return _sdPromise;
}

// ── Preset molecules ──────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Ethanol",     smiles: "CCO" },
  { label: "Benzene",     smiles: "c1ccccc1" },
  { label: "Aspirin",     smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { label: "Caffeine",    smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C" },
  { label: "Glucose",     smiles: "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O" },
  { label: "Ibuprofen",   smiles: "CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O" },
  { label: "Paracetamol", smiles: "CC(=O)Nc1ccc(O)cc1" },
  { label: "Dopamine",    smiles: "NCCc1ccc(O)c(O)c1" },
  { label: "Penicillin",  smiles: "CC1(C(=O)O)SC2C(NC1=O)C(=O)N2" },
  { label: "Cholesterol", smiles: "CC(C)CCC[C@@H](C)[C@H]1CC[C@H]2[C@@H]1CC=C3C[C@@H](O)CC[C@]23C" },
];

// ── NodeView ──────────────────────────────────────────────────────────────────

export class MoleculeBlockNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this._drawer = null;   // SmilesDrawer.SvgDrawer instance
    this._svgEl  = null;   // <svg> element reused across renders
    this._pendingSmiles = null; // queued while library loads

    this.dom = document.createElement("div");
    this.dom.className = "mol-block";

    this._build();

    // Load library then render
    loadSmilesDrawer()
      .then(SD => {
        this._initDrawer(SD);
        this._drawSmiles(this.node.attrs.smiles);
      })
      .catch(() => this._showError("Could not load SmilesDrawer library"));
  }

  // ── Patch helper ─────────────────────────────────────────────────────────────

  _patch(patch) {
    const { state, dispatch } = this.view;
    dispatch(state.tr.setNodeMarkup(this.getPos(), null, {
      ...this.node.attrs, ...patch,
    }));
  }

  get _readonly() {
    return this.view.props.editable?.() === false;
  }

  // ── Init SvgDrawer ────────────────────────────────────────────────────────────

  _initDrawer(SD) {
    const { theme } = this.node.attrs;
    this._SD = SD;
    this._drawer = new SD.SvgDrawer({
      width:  500,
      height: 300,
      compactDrawing: false,
      explicitHydrogens: false,
    });
  }

  // ── Build DOM skeleton ────────────────────────────────────────────────────────

  _build() {
    this.dom.innerHTML = "";
    this.dom.dataset.theme = this.node.attrs.theme || "light";

    if (this._readonly) {
      this._buildReadonly();
    } else {
      this._buildEditor();
    }
  }

  // ── Read-only render ──────────────────────────────────────────────────────────

  _buildReadonly() {
    const { smiles, caption, theme, width } = this.node.attrs;

    const wrap = document.createElement("div");
    wrap.className = "mol-readonly";
    wrap.style.width = width || "100%";

    // Header badge
    const badge = document.createElement("div");
    badge.className = "mol-badge";
    badge.innerHTML = `<span class="mol-badge-icon">⚗️</span><span>Molecule</span>`;
    if (smiles) {
      const smilesSpan = document.createElement("span");
      smilesSpan.className = "mol-badge-smiles";
      smilesSpan.textContent = smiles;
      badge.appendChild(smilesSpan);
    }

    // SVG container
    const svgWrap = document.createElement("div");
    svgWrap.className = `mol-svg-wrap mol-svg-wrap--${theme || "light"}`;
    this._svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._svgEl.setAttribute("width",  "500");
    this._svgEl.setAttribute("height", "300");
    this._svgEl.style.width  = "100%";
    this._svgEl.style.height = "auto";
    svgWrap.appendChild(this._svgEl);

    // Loading placeholder
    const loadingMsg = document.createElement("div");
    loadingMsg.className = "mol-loading";
    loadingMsg.textContent = "Loading structure…";
    svgWrap.appendChild(loadingMsg);
    this._loadingMsg = loadingMsg;

    wrap.appendChild(badge);
    wrap.appendChild(svgWrap);

    // Caption
    if (caption) {
      const cap = document.createElement("p");
      cap.className = "mol-caption";
      cap.textContent = caption;
      wrap.appendChild(cap);
    }

    this.dom.appendChild(wrap);
  }

  // ── Editor render ─────────────────────────────────────────────────────────────

  _buildEditor() {
    const { smiles, caption, theme, width } = this.node.attrs;

    // ── Header ──────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "mol-header";

    const title = document.createElement("div");
    title.className = "mol-title";
    title.innerHTML = `<span class="mol-title-icon">⚗️</span> Molecule`;

    const themeBtn = document.createElement("button");
    themeBtn.className = "mol-theme-btn";
    themeBtn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
    themeBtn.title = "Toggle theme";
    themeBtn.addEventListener("click", () => {
      const next = this.node.attrs.theme === "dark" ? "light" : "dark";
      this._patch({ theme: next });
    });

    const widthSelect = document.createElement("select");
    widthSelect.className = "mol-width-select";
    [["50%","50%"],["75%","75%"],["100%","100%"]].forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      if ((width || "100%") === val) opt.selected = true;
      widthSelect.appendChild(opt);
    });
    widthSelect.addEventListener("change", () => {
      this._patch({ width: widthSelect.value });
    });

    header.append(title, widthSelect, themeBtn);

    // ── SMILES input row ─────────────────────────────────────────────
    const inputRow = document.createElement("div");
    inputRow.className = "mol-input-row";

    const label = document.createElement("label");
    label.className = "mol-input-label";
    label.textContent = "SMILES";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "mol-input";
    input.value = smiles || "";
    input.placeholder = "e.g. CCO  (ethanol)";
    input.spellcheck = false;

    const drawBtn = document.createElement("button");
    drawBtn.className = "mol-draw-btn";
    drawBtn.textContent = "Draw";
    drawBtn.addEventListener("click", () => {
      const val = input.value.trim();
      this._patch({ smiles: val });
      this._drawSmiles(val);
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); drawBtn.click(); }
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "mol-copy-btn";
    copyBtn.title = "Copy SMILES";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(input.value.trim()).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });

    inputRow.append(label, input, drawBtn, copyBtn);

    // ── Presets ──────────────────────────────────────────────────────
    const presetsRow = document.createElement("div");
    presetsRow.className = "mol-presets";

    const presetsLabel = document.createElement("span");
    presetsLabel.className = "mol-presets-label";
    presetsLabel.textContent = "Presets:";
    presetsRow.appendChild(presetsLabel);

    PRESETS.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "mol-preset-btn";
      btn.textContent = p.label;
      btn.addEventListener("click", () => {
        input.value = p.smiles;
        this._patch({ smiles: p.smiles });
        this._drawSmiles(p.smiles);
      });
      presetsRow.appendChild(btn);
    });

    // ── SVG canvas ───────────────────────────────────────────────────
    const svgWrap = document.createElement("div");
    svgWrap.className = `mol-svg-wrap mol-svg-wrap--${theme || "light"}`;
    svgWrap.style.width = width || "100%";

    this._svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._svgEl.setAttribute("width",  "500");
    this._svgEl.setAttribute("height", "300");
    this._svgEl.style.width  = "100%";
    this._svgEl.style.height = "auto";
    svgWrap.appendChild(this._svgEl);

    // Loading state
    const loadingMsg = document.createElement("div");
    loadingMsg.className = "mol-loading";
    loadingMsg.textContent = smiles ? "Loading structure…" : "Enter a SMILES string above or pick a preset";
    svgWrap.appendChild(loadingMsg);
    this._loadingMsg = loadingMsg;

    // Error message
    this._errorEl = document.createElement("div");
    this._errorEl.className = "mol-error";
    this._errorEl.style.display = "none";
    svgWrap.appendChild(this._errorEl);

    // ── Caption ──────────────────────────────────────────────────────
    const captionWrap = document.createElement("div");
    captionWrap.className = "mol-caption-row";

    const captionInput = document.createElement("input");
    captionInput.type = "text";
    captionInput.className = "mol-caption-input";
    captionInput.value = caption || "";
    captionInput.placeholder = "Add a caption (optional)";
    captionInput.addEventListener("blur", () => {
      this._patch({ caption: captionInput.value });
    });
    captionInput.addEventListener("keydown", e => {
      if (e.key === "Enter") captionInput.blur();
    });

    captionWrap.appendChild(captionInput);

    // ── Assemble ─────────────────────────────────────────────────────
    this.dom.append(header, inputRow, presetsRow, svgWrap, captionWrap);
  }

  // ── Draw molecule ─────────────────────────────────────────────────────────────

  _drawSmiles(smiles) {
    if (!smiles) {
      if (this._loadingMsg) {
        this._loadingMsg.style.display = "flex";
        this._loadingMsg.textContent = "Enter a SMILES string above or pick a preset";
      }
      if (this._svgEl) this._svgEl.innerHTML = "";
      return;
    }

    if (!this._drawer) {
      // Library not loaded yet — will be called again from constructor promise
      return;
    }

    if (this._loadingMsg) this._loadingMsg.style.display = "none";
    if (this._errorEl)    this._errorEl.style.display    = "none";

    try {
      const theme = this.node.attrs.theme || "light";
      this._SD.parse(smiles, (tree) => {
        if (!tree) { this._showError("Invalid SMILES string"); return; }
        this._drawer.draw(tree, this._svgEl, theme);
        // Fix SVG viewBox to prevent clipping
        if (this._svgEl && !this._svgEl.getAttribute("viewBox")) {
          this._svgEl.setAttribute("viewBox", "0 0 500 300");
        }
      });
    } catch (err) {
      this._showError("Invalid SMILES: " + (err?.message || "parse error"));
    }
  }

  _showError(msg) {
    if (this._loadingMsg) this._loadingMsg.style.display = "none";
    if (this._errorEl) {
      this._errorEl.style.display = "flex";
      this._errorEl.textContent   = "⚠️ " + msg;
    }
  }

  // ── ProseMirror interface ─────────────────────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    const prev = this.node;
    this.node  = node;

    // Full rebuild on theme or width change (affects layout/bg)
    if (prev.attrs.theme !== node.attrs.theme) {
      this._build();
      if (this._drawer && node.attrs.smiles) this._drawSmiles(node.attrs.smiles);
      return true;
    }

    // Partial updates
    if (prev.attrs.smiles !== node.attrs.smiles && this._drawer) {
      this._drawSmiles(node.attrs.smiles);
    }
    if (prev.attrs.width !== node.attrs.width) {
      const svgWrap = this.dom.querySelector(".mol-svg-wrap");
      if (svgWrap) svgWrap.style.width = node.attrs.width || "100%";
    }

    // Sync theme data attribute
    this.dom.dataset.theme = node.attrs.theme || "light";
    const svgWrap = this.dom.querySelector(".mol-svg-wrap");
    if (svgWrap) {
      svgWrap.className = `mol-svg-wrap mol-svg-wrap--${node.attrs.theme || "light"}`;
    }

    return true;
  }

  stopEvent()      { return true; }
  ignoreMutation() { return true; }
}
