/**
 * assetRef/nodeView.js
 *
 * Inline chip that renders an asset reference.
 *
 * Appearance:
 *   [⚙ P-101A  Cooling water pump A ↗]
 *
 * Clicking the chip opens the asset in the Asset Registry (port 5177).
 * The node is purely read-display — no inline editing; use the toolbar
 * picker to insert a new ref or delete + re-insert to change it.
 */

// Base URL for deep-links into the Asset Registry UI.
// Falls back to localhost:5177 for local dev; set ASSET_REGISTRY_BASE_URL
// in server env and expose it via /api/connectors if needed.
const REGISTRY_BASE = window.__ASSET_REGISTRY_BASE__ || "http://localhost:5177";

export class AssetRefNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("span");
    this.dom.className = "asset-ref-chip";
    this._render(node.attrs);
  }

  // ── ProseMirror lifecycle ────────────────────────────────────────────────────

  update(node) {
    if (node.type.name !== "assetRef") return false;
    this.node = node;
    this._render(node.attrs);
    return true;
  }

  destroy()        {}
  stopEvent()      { return true; }
  ignoreMutation() { return true; }

  // ── Render ───────────────────────────────────────────────────────────────────

  _render(attrs) {
    const { assetId, tag, display } = attrs;

    // Parse name out of "TAG (Name)" display string, falling back to display itself
    let name = display || "";
    if (tag && display && display.startsWith(tag)) {
      name = display.slice(tag.length).replace(/^\s*[·(\-–]\s*/, "").replace(/\s*\)\s*$/, "").trim();
    }
    if (!name) name = display;

    this.dom.innerHTML = "";
    this.dom.title     = `Asset ID: ${assetId}`;

    // Icon
    const icon = document.createElement("span");
    icon.className   = "asset-ref-icon";
    icon.textContent = "⚙";

    // Tag badge
    const tagEl = document.createElement("span");
    tagEl.className   = "asset-ref-tag";
    tagEl.textContent = tag || assetId.slice(0, 8);

    // Name
    const nameEl = document.createElement("span");
    nameEl.className   = "asset-ref-name";
    nameEl.textContent = name ? `  ${name}` : "";

    // External link arrow
    const arrow = document.createElement("span");
    arrow.className   = "asset-ref-arrow";
    arrow.textContent = "↗";

    this.dom.append(icon, tagEl, nameEl, arrow);

    // Click → open asset in registry
    this.dom.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      if (assetId) window.open(`${REGISTRY_BASE}/assets/${assetId}`, "_blank");
    });

    // Prevent ProseMirror selection-drag starting inside the chip
    this.dom.addEventListener("mousedown", e => e.preventDefault());
  }
}
