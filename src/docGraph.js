/**
 * docGraph.js
 *
 * Full-screen knowledge-graph modal for document relationships.
 * Uses Cytoscape.js (already a project dependency via the diagram block)
 * to visualise the multi-hop graph returned by GET /api/docs/:id/graph.
 *
 * Public API:
 *   openGraphModal(docId, docTitle)
 */

import cytoscape from "cytoscape";

// ── Edge type meta ────────────────────────────────────────────────────────────

const EDGE_META = {
  references:    { color: "#6366f1", label: "References" },
  supersedes:    { color: "#f59e0b", label: "Supersedes" },
  superseded_by: { color: "#d97706", label: "Superseded by" },
  implements:    { color: "#10b981", label: "Implements" },
  closes:        { color: "#ef4444", label: "Closes" },
};

// ── Cytoscape stylesheet ──────────────────────────────────────────────────────

function buildStyle(centerId) {
  return [
    // Default node
    {
      selector: "node",
      style: {
        label:                  "data(label)",
        "background-color":     "#e0e7ff",
        "border-color":         "#a5b4fc",
        "border-width":         1.5,
        color:                  "#1e1b4b",
        "font-size":            11,
        "font-family":          "system-ui, sans-serif",
        "text-valign":          "center",
        "text-halign":          "center",
        "text-wrap":            "wrap",
        "text-max-width":       100,
        width:                  110,
        height:                 44,
        shape:                  "round-rectangle",
        padding:                6,
        "transition-property":  "background-color, border-color",
        "transition-duration":  "0.15s",
      },
    },
    // Center / focal node
    {
      selector: `node[id = "${centerId}"]`,
      style: {
        "background-color": "#6366f1",
        "border-color":     "#4338ca",
        "border-width":     2.5,
        color:              "#fff",
        "font-weight":      700,
        width:              130,
        height:             52,
        "font-size":        12,
      },
    },
    // Hover
    {
      selector: "node.hovered",
      style: {
        "background-color": "#c7d2fe",
        "border-color":     "#6366f1",
      },
    },
    // Selected
    {
      selector: "node:selected",
      style: {
        "background-color": "#4338ca",
        "border-color":     "#312e81",
        "border-width":     2.5,
        color:              "#fff",
      },
    },
    // Default edge
    {
      selector: "edge",
      style: {
        width:                   1.8,
        "line-color":            "#a5b4fc",
        "target-arrow-color":    "#a5b4fc",
        "target-arrow-shape":    "triangle",
        "curve-style":           "bezier",
        label:                   "data(label)",
        "font-size":             9,
        "font-family":           "system-ui, sans-serif",
        color:                   "#52525b",
        "text-background-color": "#fff",
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "text-rotation":         "autorotate",
        opacity:                 0.85,
      },
    },
    // Per-type edge colours
    ...Object.entries(EDGE_META).map(([type, { color }]) => ({
      selector: `edge[type = "${type}"]`,
      style: {
        "line-color":          color,
        "target-arrow-color":  color,
      },
    })),
    {
      selector: "edge:selected",
      style: { width: 3, opacity: 1 },
    },
  ];
}

// ── Layout builders ───────────────────────────────────────────────────────────

function buildLayout(name) {
  if (name === "breadthfirst") {
    return {
      name:           "breadthfirst",
      directed:       true,
      padding:        50,
      spacingFactor:  1.4,
      animate:        true,
      animationDuration: 450,
    };
  }
  // cose (organic force-directed)
  return {
    name:              "cose",
    animate:           true,
    animationDuration: 500,
    nodeRepulsion:     () => 10000,
    idealEdgeLength:   () => 140,
    edgeElasticity:    () => 100,
    padding:           50,
    randomize:         false,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function openGraphModal(docId, docTitle) {
  document.querySelector(".dg-overlay")?.remove();

  // ── DOM scaffold ────────────────────────────────────────────────────────────

  const overlay = document.createElement("div");
  overlay.className = "dg-overlay";
  overlay.innerHTML = `
    <div class="dg-modal">

      <div class="dg-header">
        <div class="dg-header-left">
          <span class="dg-title">Knowledge graph</span>
          <span class="dg-center-label">${esc(docTitle || "Untitled")}</span>
        </div>
        <div class="dg-controls">
          <span class="dg-ctrl-label">Depth</span>
          <div class="dg-depth-pills">
            ${[1,2,3,4,5].map(n =>
              `<button class="dg-depth-pill${n === 2 ? " active" : ""}" data-depth="${n}">${n}</button>`
            ).join("")}
          </div>
          <span class="dg-ctrl-label">Layout</span>
          <select class="dg-layout-select">
            <option value="cose">Organic</option>
            <option value="breadthfirst">Hierarchical</option>
          </select>
          <button class="dg-fit-btn" title="Fit to screen">⊡</button>
          <button class="dg-close-btn" title="Close (Esc)">✕</button>
        </div>
      </div>

      <div class="dg-body">
        <div class="dg-canvas" id="dgCanvas"></div>
        <div class="dg-sidebar">

          <div class="dg-legend">
            <div class="dg-legend-title">Edge types</div>
            ${Object.entries(EDGE_META).map(([, { color, label }]) => `
              <div class="dg-legend-row">
                <span class="dg-legend-dot" style="background:${color}"></span>
                <span class="dg-legend-label">${label}</span>
              </div>`).join("")}
          </div>

          <div class="dg-node-panel" id="dgNodePanel">
            <div class="dg-node-hint">Click a node to see details</div>
          </div>

          <div class="dg-stats" id="dgStats"></div>

        </div>
      </div>

    </div>`;

  document.body.appendChild(overlay);

  // ── Local state ─────────────────────────────────────────────────────────────

  let cy            = null;
  let currentDepth  = 2;
  let currentLayout = "cose";

  const canvasEl  = overlay.querySelector("#dgCanvas");
  const nodePanel = overlay.querySelector("#dgNodePanel");
  const statsEl   = overlay.querySelector("#dgStats");

  // ── Graph renderer ──────────────────────────────────────────────────────────

  async function renderGraph(depth) {
    // Loading state
    canvasEl.innerHTML = '<div class="dg-loading">Loading graph…</div>';
    nodePanel.innerHTML = '<div class="dg-node-hint">Click a node to see details</div>';
    statsEl.innerHTML   = "";

    let data;
    try {
      const r = await fetch(`/api/docs/${docId}/graph?depth=${depth}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      canvasEl.innerHTML = `<div class="dg-loading dg-error">Failed to load graph: ${esc(e.message)}</div>`;
      return;
    }

    if (!data.nodes.length) {
      canvasEl.innerHTML = '<div class="dg-loading">This document has no linked documents yet.</div>';
      return;
    }

    canvasEl.innerHTML = "";

    // Build Cytoscape elements
    const elements = [
      ...data.nodes.map(n => ({
        group: "nodes",
        data: {
          id:         n.id,
          label:      truncate(n.title, 28),
          title:      n.title,
          depth:      n.depth,
          updated_at: n.updated_at,
        },
      })),
      ...data.edges.map(e => ({
        group: "edges",
        data: {
          id:     e.id,
          source: e.source,
          target: e.target,
          type:   e.type,
          label:  EDGE_META[e.type]?.label ?? e.type,
        },
      })),
    ];

    if (cy) cy.destroy();

    cy = cytoscape({
      container: canvasEl,
      elements,
      style:     buildStyle(docId),
      layout:    { name: "preset" },   // place without animating first
      minZoom:   0.15,
      maxZoom:   4,
    });

    // Run layout after Cytoscape has measured the container properly
    // ResizeObserver fires once the flexbox gives the canvas its real width
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry || !cy) return;
      const w = entry.contentRect.width;
      if (w < 50) return;             // still too small, wait
      ro.disconnect();
      cy.resize();
      cy.layout(buildLayout(currentLayout)).run();
    });
    ro.observe(canvasEl);

    // Fallback: fit after layout finishes (catches cases where RO already fired)
    cy.one("layoutstop", () => cy.fit(50));

    // ── Interactions ────────────────────────────────────────────────────────

    cy.on("mouseover", "node", e => e.target.addClass("hovered"));
    cy.on("mouseout",  "node", e => e.target.removeClass("hovered"));

    // Click node → show detail panel
    cy.on("tap", "node", e => {
      const nd       = e.target.data();
      const isCenter = nd.id === docId;

      // Collect connected edges
      const connectedEdges = cy.edges(`[source = "${nd.id}"], [target = "${nd.id}"]`);
      const edgeRows = connectedEdges.map(edge => {
        const ed     = edge.data();
        const isOut  = ed.source === nd.id;
        const otherId = isOut ? ed.target : ed.source;
        const other  = cy.getElementById(otherId).data("title") || otherId;
        const meta   = EDGE_META[ed.type] ?? { color: "#6b7280", label: ed.type };
        return `<div class="dg-node-edge-row">
          <span class="dg-node-edge-dir" style="color:${meta.color}">${isOut ? "→" : "←"}</span>
          <span class="dg-node-edge-type" style="color:${meta.color}">${esc(meta.label)}</span>
          <span class="dg-node-edge-peer">${esc(truncate(other, 22))}</span>
        </div>`;
      }).join("");

      nodePanel.innerHTML = `
        <div class="dg-node-detail">
          <div class="dg-node-detail-title">${esc(nd.title)}</div>
          <div class="dg-node-detail-meta">
            ${isCenter ? '<span class="dg-badge-center">Current</span>' : `<span class="dg-badge-hop">Hop ${nd.depth}</span>`}
          </div>
          ${nd.updated_at ? `<div class="dg-node-detail-date">Updated ${formatDate(nd.updated_at)}</div>` : ""}
          ${edgeRows ? `<div class="dg-node-edges">${edgeRows}</div>` : ""}
          ${!isCenter ? `
            <a class="dg-node-open" href="/?id=${encodeURIComponent(nd.id)}">
              Open document →
            </a>` : ""}
        </div>`;
    });

    // Click canvas background → clear panel
    cy.on("tap", e => {
      if (e.target === cy) {
        nodePanel.innerHTML = '<div class="dg-node-hint">Click a node to see details</div>';
      }
    });

    // Stats bar
    statsEl.innerHTML = `
      <span class="dg-stat-item">${data.nodes.length} documents</span>
      <span class="dg-stat-sep">·</span>
      <span class="dg-stat-item">${data.edges.length} links</span>`;
  }

  // ── Control wiring ──────────────────────────────────────────────────────────

  // Depth pills
  overlay.querySelectorAll(".dg-depth-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".dg-depth-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentDepth = parseInt(btn.dataset.depth, 10);
      renderGraph(currentDepth);
    });
  });

  // Layout select
  overlay.querySelector(".dg-layout-select").addEventListener("change", e => {
    currentLayout = e.target.value;
    if (cy) cy.layout(buildLayout(currentLayout)).run();
  });

  // Fit button
  overlay.querySelector(".dg-fit-btn").addEventListener("click", () => cy?.fit(40));

  // Close
  function close() {
    overlay.remove();
    if (cy) { cy.destroy(); cy = null; }
  }
  overlay.querySelector(".dg-close-btn").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });

  // ── Initial render ──────────────────────────────────────────────────────────

  renderGraph(currentDepth);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s, len) {
  return s && s.length > len ? s.slice(0, len - 1) + "…" : (s || "");
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
}
