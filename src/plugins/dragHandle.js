/**
 * dragHandlePlugin
 *
 * Shows a ⠿ handle and a [+] insert button to the left of the hovered top-level block.
 *
 * [+] opens a Notion-style block-picker menu for inserting new blocks.
 * [⠿] drag handle moves the block to a new position in the document.
 *
 * Layout (left of block): [+] [⠿]  Block content here...
 */

import { Plugin, TextSelection } from "prosemirror-state";

// ── Block menu definition ─────────────────────────────────────────────────────

const BLOCK_MENU_SECTIONS = [
  {
    label: "Basic blocks",
    items: [
      { icon: "¶",   label: "Text",          type: "paragraph" },
      { icon: "H1",  label: "Heading 1",     type: "heading",      attrs: { level: 1 } },
      { icon: "H2",  label: "Heading 2",     type: "heading",      attrs: { level: 2 } },
      { icon: "H3",  label: "Heading 3",     type: "heading",      attrs: { level: 3 } },
      { icon: "•",   label: "Bullet list",   type: "bullet_list" },
      { icon: "1.",  label: "Ordered list",  type: "ordered_list" },
      { icon: "❝",   label: "Quote",         type: "blockquote" },
      { icon: "</>", label: "Code block",    type: "code_block" },
      { icon: "—",   label: "Divider",       type: "horizontal_rule" },
    ],
  },
  {
    label: "Media",
    items: [
      { icon: "⬜",  label: "Image",          type: "imageBlock" },
      { icon: "M↓",  label: "Markdown",       type: "markdownBlock" },
      { icon: "⬡",   label: "Mermaid diagram",type: "mermaidBlock" },
    ],
  },
  {
    label: "Documents",
    items: [
      { icon: "📋",  label: "Meeting notes",  type: "meetingNotes" },
      { icon: "☑",   label: "Todo list",      type: "todoBlock" },
    ],
  },
  {
    label: "Data & Visualization",
    items: [
      { icon: "⊞",   label: "Table",          type: "table" },
      { icon: "📊",  label: "Chart",          type: "graph" },
      { icon: "🗂",  label: "Kanban",         type: "kanban" },
      { icon: "⚠",   label: "Risk matrix",    type: "riskMatrix" },
      { icon: "🔩",  label: "Bill of materials",type: "bomBlock" },
      { icon: "🔧",  label: "Maintenance",    type: "maintenanceBlock" },
      { icon: "🗺",  label: "Map",            type: "map" },
      { icon: "◈",   label: "Diagram",        type: "diagram" },
    ],
  },
];

// ── Plugin ────────────────────────────────────────────────────────────────────

export function dragHandlePlugin() {
  return new Plugin({
    view(editorView) {
      const wrapper = editorView.dom.parentElement;
      wrapper.style.position = "relative";

      // ── DOM elements ──────────────────────────────────────────────────────

      // Drag handle ⠿
      const handle = document.createElement("div");
      handle.className = "pm-dh";
      handle.draggable = true;
      handle.title     = "Drag to move";
      handle.innerHTML = `
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="2.5"  r="1.5"/>
          <circle cx="7" cy="2.5"  r="1.5"/>
          <circle cx="3" cy="8"    r="1.5"/>
          <circle cx="7" cy="8"    r="1.5"/>
          <circle cx="3" cy="13.5" r="1.5"/>
          <circle cx="7" cy="13.5" r="1.5"/>
        </svg>`;
      wrapper.appendChild(handle);

      // Plus button [+]
      const plusBtn = document.createElement("div");
      plusBtn.className = "pm-plus-btn";
      plusBtn.title     = "Insert block below";
      plusBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
      wrapper.appendChild(plusBtn);

      // Drop indicator line
      const dropLine = document.createElement("div");
      dropLine.className     = "pm-drop-line";
      dropLine.style.opacity = "0";
      wrapper.appendChild(dropLine);

      // Block picker menu (appended to body so it can overflow any container)
      const blockMenu = document.createElement("div");
      blockMenu.className    = "pm-block-menu";
      blockMenu.style.display = "none";

      let menuHTML = `<div class="pm-bm-search-wrap">
        <input class="pm-bm-search" placeholder="Filter blocks…" autocomplete="off" />
      </div>`;
      for (const section of BLOCK_MENU_SECTIONS) {
        menuHTML += `<div class="pm-bm-section">
          <div class="pm-bm-label">${section.label}</div>`;
        for (const item of section.items) {
          const attrsJson = JSON.stringify(item.attrs || {}).replace(/'/g, "&#39;");
          menuHTML += `<button class="pm-bm-item" data-type="${item.type}" data-attrs='${attrsJson}'>
            <span class="pm-bm-icon">${item.icon}</span>
            <span class="pm-bm-name">${item.label}</span>
          </button>`;
        }
        menuHTML += `</div>`;
      }
      blockMenu.innerHTML = menuHTML;
      document.body.appendChild(blockMenu);

      // ── Local state ───────────────────────────────────────────────────────

      let hoveredPos  = null;   // offset of the top-level block under the mouse
      let draggedPos  = null;   // offset of the block being dragged (null = idle)
      let draggedDOM  = null;   // its DOM element (to apply faded style)
      let menuOpen    = false;

      // ── Helper: find which top-level block the pointer is over ────────────
      // Uses nearest-block logic so the handle stays visible in the gaps
      // between blocks (which can be 16–20 px with typical margins).

      function blockAtY(clientY) {
        let result   = null;
        let bestDist = Infinity;

        editorView.state.doc.forEach((node, offset) => {
          const dom = editorView.nodeDOM(offset);
          if (!(dom instanceof Element)) return;
          const r = dom.getBoundingClientRect();

          // Cursor is directly inside the block — perfect match
          if (clientY >= r.top && clientY <= r.bottom) {
            if (bestDist > 0) { bestDist = 0; result = offset; }
            return;
          }

          // Cursor is outside — find nearest block within 60 px
          const dist = clientY < r.top ? r.top - clientY : clientY - r.bottom;
          if (dist < bestDist && dist < 60) {
            bestDist = dist;
            result   = offset;
          }
        });

        return result;
      }

      // ── Helper: find the nearest gap between blocks for drop position ─────

      function dropPosAt(clientY) {
        const { doc } = editorView.state;
        let bestPos  = 0;
        let bestDist = Infinity;

        doc.forEach((node, offset) => {
          const dom = editorView.nodeDOM(offset);
          if (!(dom instanceof Element)) return;
          const r = dom.getBoundingClientRect();

          const dTop = Math.abs(clientY - r.top);
          if (dTop < bestDist) { bestDist = dTop; bestPos = offset; }

          const dBot = Math.abs(clientY - r.bottom);
          if (dBot < bestDist) { bestDist = dBot; bestPos = offset + node.nodeSize; }
        });

        return bestPos;
      }

      // ── Helper: show/hide the blue drop-line at a document position ───────
      // Must add wrapper.scrollTop because the line is position:absolute inside
      // the scroll container (#editor), so its top is relative to content-top
      // not the visible viewport top.

      function showDropLine(pos) {
        const { doc } = editorView.state;
        const wRect   = wrapper.getBoundingClientRect();
        let dom = null, atTop = false;

        doc.forEach((node, offset) => {
          if (offset === pos)                 { dom = editorView.nodeDOM(offset); atTop = true;  }
          if (offset + node.nodeSize === pos) { dom = editorView.nodeDOM(offset); atTop = false; }
        });

        if (!(dom instanceof Element)) { dropLine.style.opacity = "0"; return; }
        const nRect = dom.getBoundingClientRect();
        const y     = (atTop ? nRect.top : nRect.bottom) - wRect.top + wrapper.scrollTop;
        dropLine.style.top     = `${y}px`;
        dropLine.style.opacity = "1";
      }

      // ── Helper: dispatch the move transaction ─────────────────────────────

      function moveBlock(from, to) {
        const { state } = editorView;
        const node = state.doc.nodeAt(from);
        if (!node) return;

        const size = node.nodeSize;
        if (to === from || to === from + size) return;

        let tr = state.tr;
        if (to < from) {
          tr = tr.insert(to, node);
          tr = tr.delete(from + size, from + 2 * size);
        } else {
          tr = tr.delete(from, from + size);
          tr = tr.insert(to - size, node);
        }
        editorView.dispatch(tr.scrollIntoView());
      }

      // ── Block insertion ───────────────────────────────────────────────────

      function insertBlock(pos, typeName, attrs) {
        const { state } = editorView;
        const { schema } = state;
        const anchorBlock = state.doc.nodeAt(pos);
        if (!anchorBlock) return;
        const insertPos = pos + anchorBlock.nodeSize;

        let newNode;
        try {
          if (typeName === "bullet_list" || typeName === "ordered_list") {
            const para = schema.nodes.paragraph.createAndFill();
            const item = schema.nodes.list_item.createAndFill(null, para);
            newNode = schema.nodes[typeName].createAndFill(null, item);

          } else if (typeName === "table") {
            const mkCell   = () => schema.nodes.table_cell.createAndFill(null, schema.nodes.paragraph.createAndFill());
            const mkHeader = () => schema.nodes.table_header.createAndFill(null, schema.nodes.paragraph.createAndFill());
            const hRow = schema.nodes.table_row.createAndFill(null, [mkHeader(), mkHeader(), mkHeader()]);
            const dRow = () => schema.nodes.table_row.createAndFill(null, [mkCell(), mkCell(), mkCell()]);
            newNode = schema.nodes.table.createAndFill(null, [hRow, dRow(), dRow()]);

          } else if (typeName === "blockquote") {
            const para = schema.nodes.paragraph.createAndFill();
            newNode = schema.nodes.blockquote.createAndFill(null, para);

          } else if (typeName === "horizontal_rule") {
            newNode = schema.nodes.horizontal_rule.create();

          } else {
            const nodeType = schema.nodes[typeName];
            if (!nodeType) { console.warn(`pm-block-menu: unknown type "${typeName}"`); return; }
            newNode = nodeType.createAndFill(attrs && Object.keys(attrs).length ? attrs : undefined);
          }
        } catch (err) {
          console.warn("pm-block-menu: could not create node", typeName, err);
          return;
        }

        if (!newNode) { console.warn("pm-block-menu: createAndFill returned null for", typeName); return; }

        let tr = state.tr.insert(insertPos, newNode);

        // Move cursor inside the new block (works for paragraph, heading, etc.)
        try {
          const $pos = tr.doc.resolve(insertPos + 1);
          tr = tr.setSelection(TextSelection.near($pos));
        } catch (_) { /* atom nodes — no cursor needed */ }

        editorView.dispatch(tr.scrollIntoView());
        editorView.focus();
      }

      // ── Menu open / close ─────────────────────────────────────────────────

      function openMenu() {
        if (hoveredPos === null) return;
        menuOpen = true;
        blockMenu.style.display = "flex";

        // Position below the plus button
        const btnRect = plusBtn.getBoundingClientRect();
        let top  = btnRect.bottom + 6;
        let left = btnRect.left;

        // Reflow to get real dimensions, then clamp to viewport
        const mw = blockMenu.offsetWidth  || 220;
        const mh = blockMenu.offsetHeight || 350;
        if (left + mw > window.innerWidth  - 8) left = window.innerWidth  - mw - 8;
        if (top  + mh > window.innerHeight - 8) top  = btnRect.top - mh - 4;

        blockMenu.style.left = `${left}px`;
        blockMenu.style.top  = `${top}px`;

        const searchEl = blockMenu.querySelector(".pm-bm-search");
        if (searchEl) { searchEl.value = ""; filterMenu(""); searchEl.focus(); }
      }

      function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        blockMenu.style.display = "none";
      }

      function filterMenu(query) {
        const q = query.toLowerCase().trim();
        blockMenu.querySelectorAll(".pm-bm-item").forEach(item => {
          const name = item.querySelector(".pm-bm-name").textContent.toLowerCase();
          item.style.display = (!q || name.includes(q)) ? "" : "none";
        });
        blockMenu.querySelectorAll(".pm-bm-section").forEach(section => {
          const hasVisible = [...section.querySelectorAll(".pm-bm-item")].some(i => i.style.display !== "none");
          section.style.display = hasVisible ? "" : "none";
        });
      }

      // ── Menu event listeners ──────────────────────────────────────────────

      plusBtn.addEventListener("mousedown", e => {
        e.preventDefault(); // prevent editor blur
        e.stopPropagation();
      });

      plusBtn.addEventListener("click", e => {
        e.stopPropagation();
        menuOpen ? closeMenu() : openMenu();
      });

      blockMenu.addEventListener("mousedown", e => {
        e.preventDefault(); // prevent editor blur when clicking menu
      });

      blockMenu.addEventListener("click", e => {
        const item = e.target.closest(".pm-bm-item");
        if (!item) return;
        e.stopPropagation();
        const typeName = item.dataset.type;
        const attrs    = JSON.parse(item.dataset.attrs || "{}");
        const posToInsert = hoveredPos;
        closeMenu();
        if (posToInsert !== null) insertBlock(posToInsert, typeName, attrs);
      });

      const searchInput = blockMenu.querySelector(".pm-bm-search");
      searchInput.addEventListener("input", e => filterMenu(e.target.value));

      searchInput.addEventListener("keydown", e => {
        if (e.key === "Escape") { closeMenu(); editorView.focus(); e.preventDefault(); return; }
        if (e.key === "Enter") {
          const first = [...blockMenu.querySelectorAll(".pm-bm-item")].find(i => i.style.display !== "none");
          if (first) first.click();
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowDown") {
          const items = [...blockMenu.querySelectorAll(".pm-bm-item")].filter(i => i.style.display !== "none");
          if (items.length) { items[0].focus(); }
          e.preventDefault();
        }
      });

      blockMenu.addEventListener("keydown", e => {
        if (e.key === "Escape") { closeMenu(); editorView.focus(); e.preventDefault(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const items = [...blockMenu.querySelectorAll(".pm-bm-item")].filter(i => i.style.display !== "none");
          const idx   = items.indexOf(document.activeElement);
          if (e.key === "ArrowDown" && idx < items.length - 1) items[idx + 1].focus();
          if (e.key === "ArrowUp") {
            if (idx > 0) items[idx - 1].focus();
            else searchInput.focus();
          }
          e.preventDefault();
        }
      });

      // Close on outside click
      document.addEventListener("mousedown", function onOutside(e) {
        if (menuOpen && !blockMenu.contains(e.target) && e.target !== plusBtn) closeMenu();
      });

      // ── Mouse move: track block, reposition handle + plusBtn ──────────────

      editorView.dom.addEventListener("mousemove", e => {
        if (draggedPos !== null) return;

        const pos = blockAtY(e.clientY);
        if (pos === null) {
          handle.style.opacity  = "0";
          plusBtn.style.opacity = "0";
          return;
        }
        hoveredPos = pos;

        const dom = editorView.nodeDOM(pos);
        if (!(dom instanceof Element)) {
          handle.style.opacity  = "0";
          plusBtn.style.opacity = "0";
          return;
        }

        const wRect     = wrapper.getBoundingClientRect();
        const nRect     = dom.getBoundingClientRect();
        // Add wrapper.scrollTop: handle is position:absolute inside the scroll
        // container, so its top is relative to the content-box top, not the
        // visible viewport top.
        const scrollTop = wrapper.scrollTop;
        const top       = nRect.top - wRect.top + scrollTop + nRect.height / 2 - 10;
        const left      = nRect.left - wRect.left;

        handle.style.opacity = "1";
        handle.style.top     = `${top}px`;
        handle.style.left    = `${left - 28}px`;

        plusBtn.style.opacity = "1";
        plusBtn.style.top     = `${top}px`;
        plusBtn.style.left    = `${left - 52}px`;
      });

      editorView.dom.addEventListener("mouseleave", e => {
        if (draggedPos === null) {
          // Don't hide when the mouse moves onto the handle or plus button —
          // that's the normal grab gesture. They maintain their own visibility.
          const to = e.relatedTarget;
          if (to === handle || handle.contains(to) ||
              to === plusBtn || plusBtn.contains(to)) return;
          handle.style.opacity  = "0";
          plusBtn.style.opacity = "0";
        }
      });

      // Keep handle/plusBtn visible while the mouse is on them
      // (JS opacity:"0" would otherwise win over CSS :hover on the way in)
      handle.addEventListener("mouseenter", () => {
        if (hoveredPos === null) return;
        handle.style.opacity  = "1";
        plusBtn.style.opacity = "1";
      });
      plusBtn.addEventListener("mouseenter", () => {
        if (hoveredPos === null) return;
        handle.style.opacity  = "1";
        plusBtn.style.opacity = "1";
      });

      // ── Handle: drag start ────────────────────────────────────────────────

      handle.addEventListener("dragstart", e => {
        if (hoveredPos === null) { e.preventDefault(); return; }

        draggedPos = hoveredPos;
        draggedDOM = editorView.nodeDOM(draggedPos);
        if (draggedDOM instanceof Element) draggedDOM.classList.add("pm-block-dragging");

        e.dataTransfer.effectAllowed = "move";

        // Suppress the browser's default drag ghost — the faded block (pm-block-dragging)
        // and the blue drop-line already give enough visual feedback.
        // A 1×1 blank canvas is the most reliable cross-browser way to do this.
        const blank = document.createElement("canvas");
        blank.width = blank.height = 1;
        document.body.appendChild(blank);
        e.dataTransfer.setDragImage(blank, 0, 0);
        setTimeout(() => blank.remove(), 0);
      });

      handle.addEventListener("dragend", () => {
        if (draggedDOM instanceof Element) draggedDOM.classList.remove("pm-block-dragging");
        draggedPos = null;
        draggedDOM = null;
        handle.style.opacity   = "0";
        plusBtn.style.opacity  = "0";
        dropLine.style.opacity = "0";
      });

      // ── Drag feedback — listen on wrapper (full #editor column) ─────────────
      // The handle sits in the left gutter (padding of wrapper), outside
      // editorView.dom. If we listened only on editorView.dom, dragover would
      // never fire while the mouse is in the gutter, so the drop-line would
      // be invisible for the entire left ~52 px of the editor. Using wrapper
      // means we get events across the whole column.

      wrapper.addEventListener("dragover", e => {
        if (draggedPos === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        showDropLine(dropPosAt(e.clientY));
      });

      wrapper.addEventListener("dragleave", e => {
        if (draggedPos === null) return;
        // Only hide when the mouse truly leaves the wrapper (not just moves
        // between its children).
        if (wrapper.contains(e.relatedTarget)) return;
        dropLine.style.opacity = "0";
      });

      // ── Drop — commit the move ────────────────────────────────────────────

      wrapper.addEventListener("drop", e => {
        if (draggedPos === null) return;
        e.preventDefault();
        e.stopPropagation();

        const to = dropPosAt(e.clientY);
        dropLine.style.opacity = "0";

        if (to !== null) moveBlock(draggedPos, to);

        if (draggedDOM instanceof Element) draggedDOM.classList.remove("pm-block-dragging");
        draggedPos = null;
        draggedDOM = null;
        handle.style.opacity  = "0";
        plusBtn.style.opacity = "0";
      });

      return {
        destroy() {
          handle.remove();
          plusBtn.remove();
          dropLine.remove();
          blockMenu.remove();
        },
      };
    },
  });
}
