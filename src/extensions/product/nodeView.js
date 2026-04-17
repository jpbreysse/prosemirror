/**
 * extensions/product/nodeView.js
 *
 * A pure-DOM ProseMirror NodeView for an interactive product configurator.
 * No external library — just HTML, CSS classes and ProseMirror transactions.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │  [preview]   [name]                        │
 *   │  (colour     [description]                 │
 *   │   swatch)    [● colour swatches ]          │
 *   │              [size buttons      ]          │
 *   │              [material pills    ]          │
 *   │              [qty ─]  [price]  [Add to Cart│
 *   ├────────────────────────────────────────────┤
 *   │  SKU: SHOE-BLUE-42-STD          ✎ Edit     │
 *   └────────────────────────────────────────────┘
 *   (edit panel — collapsible)
 *
 * Every user interaction dispatches a setNodeMarkup transaction so the
 * full configuration is always stored in ProseMirror and is undo-able.
 */

// ── DOM micro-helpers ────────────────────────────────────────────────────────

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  children.flat().forEach(c => {
    if (!c) return;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return e;
}

function btn(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("mousedown", e => e.preventDefault());
  b.addEventListener("click",     e => { e.stopPropagation(); onClick(e); });
  return b;
}

function inp(cls, value, type = "text") {
  const i = document.createElement("input");
  i.className = cls;
  i.type      = type;
  i.value     = value;
  i.addEventListener("mousedown", e => e.stopPropagation());
  i.addEventListener("click",     e => e.stopPropagation());
  return i;
}

function textarea(cls, value) {
  const t = document.createElement("textarea");
  t.className = cls;
  t.value     = value;
  t.rows      = 2;
  t.addEventListener("mousedown", e => e.stopPropagation());
  t.addEventListener("click",     e => e.stopPropagation());
  return t;
}

// ── SKU generator ────────────────────────────────────────────────────────────

function makeSku(attrs) {
  const parts = [
    attrs.name.replace(/\s+/g, "-").toUpperCase().slice(0, 10),
    attrs.selectedColor.toUpperCase(),
    attrs.selectedSize,
    attrs.selectedMaterial.toUpperCase().slice(0, 3),
  ];
  return parts.join("-");
}

// ── Price calculator ─────────────────────────────────────────────────────────

function calcPrice(attrs) {
  const colorMod    = attrs.colors.find(c => c.id === attrs.selectedColor)?.modifier    ?? 0;
  const materialMod = attrs.materials.find(m => m.id === attrs.selectedMaterial)?.modifier ?? 0;
  return (attrs.basePrice + colorMod + materialMod) * attrs.quantity;
}

// ── NodeView ─────────────────────────────────────────────────────────────────

export class ProductNodeView {
  constructor(node, view, getPos) {
    this.node    = node;
    this.view    = view;
    this.getPos  = getPos;
    this._panelOpen = false;

    // Root
    this.dom = el("div", "product-node");
    this.dom.contentEditable = "false";

    // Card
    this.card = el("div", "product-card");
    this.dom.appendChild(this.card);

    // Footer bar (SKU + edit button)
    this.footer = el("div", "product-footer-bar");
    this.skuEl  = el("span", "product-sku");
    const editBtn = btn("product-edit-btn", "✎ Edit", () => this._togglePanel());
    this.footer.append(this.skuEl, editBtn);
    this.dom.appendChild(this.footer);

    // Edit panel
    this.panel = el("div", "product-panel");
    this.panel.style.display = "none";
    this.dom.appendChild(this.panel);

    // First render
    this._renderCard(node.attrs);
  }

  // ── Card rendering ────────────────────────────────────────────────

  _renderCard(attrs) {
    this.card.innerHTML = "";

    const color = attrs.colors.find(c => c.id === attrs.selectedColor)
                  ?? attrs.colors[0];

    // ── Left: preview ───────────────────────────────────────────
    const preview = el("div", "product-preview");

    if (attrs.image) {
      const img = document.createElement("img");
      img.src       = attrs.image;
      img.alt       = attrs.name;
      img.className = "product-img";
      preview.appendChild(img);
    } else {
      // Colour placeholder — gradient square using the selected colour
      const ph = el("div", "product-placeholder");
      ph.style.background = `linear-gradient(135deg, ${color.hex}cc 0%, ${color.hex} 100%)`;
      const icon = el("div", "product-placeholder-icon", "👟");
      ph.appendChild(icon);
      preview.appendChild(ph);
    }

    // Small colour dot badge
    const dot = el("div", "product-color-dot");
    dot.style.background = color.hex;
    dot.title = color.label;
    preview.appendChild(dot);

    this.card.appendChild(preview);

    // ── Right: details ──────────────────────────────────────────
    const details = el("div", "product-details");

    // Name + description
    details.appendChild(el("h3", "product-name", attrs.name));
    details.appendChild(el("p",  "product-desc", attrs.description));

    // ── Colour swatches ──────────────────────────────────────
    const colorGroup = el("div", "product-option-group");
    colorGroup.appendChild(el("span", "product-option-label", "Colour"));
    const swatches = el("div", "product-swatches");
    attrs.colors.forEach(c => {
      const sw = el("div", `product-swatch${c.id === attrs.selectedColor ? " selected" : ""}`);
      sw.style.background = c.hex;
      sw.title            = c.modifier > 0 ? `${c.label} (+${attrs.currency}${c.modifier})` : c.label;
      sw.addEventListener("mousedown", e => e.preventDefault());
      sw.addEventListener("click", e => {
        e.stopPropagation();
        this._updateAttrs({ selectedColor: c.id });
      });
      swatches.appendChild(sw);
    });
    colorGroup.appendChild(swatches);

    // Show selected colour name
    const colorName = el("span", "product-selected-label", color.label);
    if (color.modifier > 0) {
      colorName.appendChild(document.createTextNode(` (+${attrs.currency}${color.modifier})`));
    }
    colorGroup.appendChild(colorName);
    details.appendChild(colorGroup);

    // ── Size buttons ──────────────────────────────────────────
    const sizeGroup = el("div", "product-option-group");
    sizeGroup.appendChild(el("span", "product-option-label", "Size"));
    const sizes = el("div", "product-size-grid");
    attrs.sizes.forEach(s => {
      const sb = btn(
        `product-size-btn${s === attrs.selectedSize ? " selected" : ""}`,
        s,
        () => this._updateAttrs({ selectedSize: s })
      );
      sizes.appendChild(sb);
    });
    sizeGroup.appendChild(sizes);
    details.appendChild(sizeGroup);

    // ── Material pills ────────────────────────────────────────
    const matGroup = el("div", "product-option-group");
    matGroup.appendChild(el("span", "product-option-label", "Material"));
    const mats = el("div", "product-material-grid");
    attrs.materials.forEach(m => {
      const mb = btn(
        `product-material-btn${m.id === attrs.selectedMaterial ? " selected" : ""}`,
        m.modifier > 0 ? `${m.label} +${attrs.currency}${m.modifier}` : m.label,
        () => this._updateAttrs({ selectedMaterial: m.id })
      );
      mats.appendChild(mb);
    });
    matGroup.appendChild(mats);
    details.appendChild(matGroup);

    // ── Quantity + CTA ────────────────────────────────────────
    const cta = el("div", "product-cta-row");

    // Quantity stepper
    const qtyWrap = el("div", "product-qty");
    const qtyMinus = btn("product-qty-btn", "−", () => {
      if (attrs.quantity > 1) this._updateAttrs({ quantity: attrs.quantity - 1 });
    });
    const qtyDisplay = el("span", "product-qty-val", String(attrs.quantity));
    const qtyPlus  = btn("product-qty-btn", "+", () => {
      this._updateAttrs({ quantity: attrs.quantity + 1 });
    });
    qtyWrap.append(qtyMinus, qtyDisplay, qtyPlus);
    cta.appendChild(qtyWrap);

    // Price
    const price = calcPrice(attrs);
    const priceEl = el("div", "product-price",
      el("span", "product-price-currency", attrs.currency),
      el("span", "product-price-amount",   price.toFixed(2))
    );
    cta.appendChild(priceEl);

    // Add to cart button (visual only)
    const cartBtn = btn("product-cart-btn", "🛒 Add to cart", () => {
      cartBtn.textContent = "✓ Added!";
      cartBtn.classList.add("added");
      setTimeout(() => {
        cartBtn.textContent = "🛒 Add to cart";
        cartBtn.classList.remove("added");
      }, 1800);
    });
    cta.appendChild(cartBtn);

    details.appendChild(cta);
    this.card.appendChild(details);

    // Update SKU
    this.skuEl.textContent = `SKU: ${makeSku(attrs)}`;
  }

  // ── Edit panel ────────────────────────────────────────────────────

  _togglePanel() {
    this._panelOpen = !this._panelOpen;
    this.panel.style.display = this._panelOpen ? "block" : "none";
    if (this._panelOpen) this._renderPanel();
  }

  _renderPanel() {
    this.panel.innerHTML = "";
    const a = this.node.attrs;

    const row = (label, inputEl) => {
      const wrap = el("label", "product-panel-field");
      wrap.appendChild(el("span", "product-panel-label", label));
      wrap.appendChild(inputEl);
      return wrap;
    };

    // Basic fields
    const nameInp  = inp("product-panel-input", a.name);
    const descInp  = textarea("product-panel-input product-panel-textarea", a.description);
    const imgInp   = inp("product-panel-input product-panel-input--wide", a.image);
    imgInp.placeholder = "https://… (leave empty for colour preview)";
    const priceInp = inp("product-panel-input", a.basePrice, "number");
    const currInp  = inp("product-panel-input product-panel-input--xs", a.currency);

    const applyBtn = btn("product-panel-apply", "Apply", () => {
      this._updateAttrs({
        name:      nameInp.value.trim()  || a.name,
        description: descInp.value.trim() || a.description,
        image:     imgInp.value.trim(),
        basePrice: parseFloat(priceInp.value) || a.basePrice,
        currency:  currInp.value.trim()  || a.currency,
      });
      this._togglePanel();
    });

    const basicSection = el("div", "product-panel-section");
    basicSection.appendChild(el("h4", "product-panel-heading", "Product details"));
    basicSection.append(
      row("Name",        nameInp),
      row("Description", descInp),
      row("Image URL",   imgInp),
      row("Base price",  priceInp),
      row("Currency",    currInp),
      applyBtn,
    );
    this.panel.appendChild(basicSection);

    // Tip
    const tip = el("p", "product-panel-tip",
      "💡 Click swatches, sizes and materials directly on the card to configure. Drag quantity with ＋/－."
    );
    this.panel.appendChild(tip);
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
    this._renderCard(node.attrs);
    if (this._panelOpen) this._renderPanel();
    return true;
  }

  destroy() {}

  // Block all mouse/keyboard events from reaching ProseMirror
  // (we handle them ourselves on buttons/swatches)
  stopEvent(event) {
    // Let Tab and Escape still work globally
    if (event.type === "keydown") {
      const k = event.key;
      if (k === "Tab" || k === "Escape") return false;
    }
    return true;
  }

  ignoreMutation() { return true; }
}
