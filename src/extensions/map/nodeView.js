/**
 * extensions/map/nodeView.js
 *
 * A ProseMirror NodeView that embeds an interactive Leaflet map.
 *
 * Key Leaflet-specific concerns:
 *   1. L.map() must be called AFTER the container is attached to the DOM.
 *      We defer init with requestAnimationFrame to guarantee the container
 *      is live before Leaflet measures it.
 *   2. map.invalidateSize() must be called whenever the container is
 *      resized or re-shown (e.g. after being hidden).
 *   3. stopEvent() returns true for all mouse/touch/wheel events so Leaflet
 *      can handle pan and zoom without ProseMirror interfering.
 *   4. ignoreMutation() returns true because Leaflet continuously rewrites
 *      its own DOM (tile layers, attribution, zoom controls…) and we don't
 *      want ProseMirror to reconcile those changes.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet ships icon images as separate files; Vite needs these explicit hints
// to bundle them and give Leaflet the correct runtime URLs.
import markerIcon2x    from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon      from "leaflet/dist/images/marker-icon.png";
import markerShadow    from "leaflet/dist/images/marker-shadow.png";

// Fix the broken default icon paths that occur when bundling with Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl:       markerIcon,
  shadowUrl:     markerShadow,
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function field(labelText, inputEl) {
  const wrap = document.createElement("label");
  wrap.className = "map-field";
  const lbl = document.createElement("span");
  lbl.textContent = labelText;
  wrap.append(lbl, inputEl);
  return wrap;
}

function numInput(value, min, max, step = 1) {
  const el = document.createElement("input");
  el.type  = "number";
  el.value = value;
  if (min  !== undefined) el.min  = min;
  if (max  !== undefined) el.max  = max;
  el.step  = step;
  return el;
}

function textInput(value, placeholder = "") {
  const el = document.createElement("input");
  el.type        = "text";
  el.value       = value;
  el.placeholder = placeholder;
  return el;
}

// ------------------------------------------------------------------
// NodeView
// ------------------------------------------------------------------

export class MapNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this.map    = null;
    this._marker     = null;
    this._panelOpen  = false;

    // ── Outer wrapper ─────────────────────────────────────────────
    this.dom = document.createElement("div");
    this.dom.className = "map-node";

    // ── Map container (Leaflet renders inside here) ───────────────
    this.mapContainer = document.createElement("div");
    this.mapContainer.className = "map-container";
    this.mapContainer.style.height = node.attrs.height + "px";
    this.dom.appendChild(this.mapContainer);

    // ── Optional caption ──────────────────────────────────────────
    this.captionEl = document.createElement("p");
    this.captionEl.className = "map-caption";
    this._syncCaption(node.attrs.caption);
    this.dom.appendChild(this.captionEl);

    // ── Edit button ───────────────────────────────────────────────
    const editBtn = document.createElement("button");
    editBtn.className   = "map-edit-btn";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._togglePanel();
    });
    this.dom.appendChild(editBtn);

    // ── Edit panel ────────────────────────────────────────────────
    this._buildPanel(node.attrs);
    this.dom.appendChild(this.panel);

    // ── Defer Leaflet init until the container is in the DOM ──────
    // requestAnimationFrame guarantees the container is measured correctly.
    requestAnimationFrame(() => this._initMap(node.attrs));
  }

  // ── Leaflet lifecycle ───────────────────────────────────────────

  _initMap({ lat, lng, zoom }) {
    if (this.map) return; // already initialised

    this.map = L.map(this.mapContainer, {
      center:          [lat, lng],
      zoom,
      zoomControl:     true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    this._marker = L.marker([lat, lng]).addTo(this.map);

    // When the user pans/zooms, update the node attrs so the position
    // is persisted in the ProseMirror document.
    this.map.on("moveend zoomend", () => {
      const c = this.map.getCenter();
      this._updateAttrs({
        lat:  Math.round(c.lat * 1e6) / 1e6,
        lng:  Math.round(c.lng * 1e6) / 1e6,
        zoom: this.map.getZoom(),
      });
    });

    // Move marker on click
    this.map.on("click", (e) => {
      this._marker.setLatLng(e.latlng);
      this._updateAttrs({
        lat: Math.round(e.latlng.lat * 1e6) / 1e6,
        lng: Math.round(e.latlng.lng * 1e6) / 1e6,
      });
    });
  }

  _syncMap({ lat, lng, zoom, height }) {
    if (!this.map) return;
    this.mapContainer.style.height = height + "px";
    this.map.invalidateSize();
    this.map.setView([lat, lng], zoom, { animate: false });
    this._marker?.setLatLng([lat, lng]);
  }

  _syncCaption(text) {
    this.captionEl.textContent = text || "";
    this.captionEl.style.display = text ? "block" : "none";
  }

  // ── Panel ───────────────────────────────────────────────────────

  _buildPanel(attrs) {
    this.panel = document.createElement("div");
    this.panel.className    = "map-panel";
    this.panel.style.display = "none";

    this._latInput     = numInput(attrs.lat,    -90,  90,   0.000001);
    this._lngInput     = numInput(attrs.lng,   -180, 180,   0.000001);
    this._zoomInput    = numInput(attrs.zoom,     1,  20,   1);
    this._heightInput  = numInput(attrs.height, 150, 800,  10);
    this._captionInput = textInput(attrs.caption, "Optional caption…");

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.className   = "map-apply-btn";
    applyBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._applyPanel();
    });

    this.panel.append(
      field("Latitude",   this._latInput),
      field("Longitude",  this._lngInput),
      field("Zoom",       this._zoomInput),
      field("Height (px)", this._heightInput),
      field("Caption",    this._captionInput),
      applyBtn,
    );
  }

  _togglePanel() {
    this._panelOpen = !this._panelOpen;
    this.panel.style.display = this._panelOpen ? "flex" : "none";
  }

  _applyPanel() {
    this._updateAttrs({
      lat:     parseFloat(this._latInput.value)    || 0,
      lng:     parseFloat(this._lngInput.value)    || 0,
      zoom:    parseInt(this._zoomInput.value)      || 13,
      height:  parseInt(this._heightInput.value)   || 300,
      caption: this._captionInput.value.trim(),
    });
    this._togglePanel();
  }

  _updateAttrs(patch) {
    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, { ...this.node.attrs, ...patch })
    );
  }

  // ── ProseMirror NodeView interface ──────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._syncMap(node.attrs);
    this._syncCaption(node.attrs.caption);

    if (this._panelOpen) {
      this._latInput.value     = node.attrs.lat;
      this._lngInput.value     = node.attrs.lng;
      this._zoomInput.value    = node.attrs.zoom;
      this._heightInput.value  = node.attrs.height;
      this._captionInput.value = node.attrs.caption;
    }
    return true;
  }

  destroy() {
    if (this.map) {
      this.map.remove(); // Leaflet teardown (removes event listeners, tiles, etc.)
      this.map = null;
    }
  }

  // Let ALL events through to Leaflet (pan, zoom, click)
  // except keyboard events so Tab/Escape still work for the editor.
  stopEvent(event) {
    if (event.type === "keydown" || event.type === "keyup") return false;
    return true;
  }

  // Leaflet heavily mutates its own DOM (tiles, zoom controls, attribution).
  // Returning true tells ProseMirror to ignore all of those changes.
  ignoreMutation() {
    return true;
  }
}
