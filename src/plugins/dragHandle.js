/**
 * dragHandlePlugin
 *
 * Shows a ⠿ handle to the left of the hovered top-level block.
 * Dragging the handle moves the block to a new position in the document.
 *
 * Visual feedback:
 *   – Handle appears on hover (fades on mouse-leave)
 *   – Blue drop-indicator line follows the cursor between blocks while dragging
 *   – Dragged block's DOM is slightly faded
 *
 * Works for every block type: paragraphs, headings, images,
 * kanban boards, graphs, markdown blocks, etc.
 */

import { Plugin } from "prosemirror-state";

export function dragHandlePlugin() {
  return new Plugin({
    view(editorView) {
      const wrapper = editorView.dom.parentElement;
      wrapper.style.position = "relative";

      // ── DOM elements ────────────────────────────────────────────────────────

      const handle = document.createElement("div");
      handle.className  = "pm-dh";
      handle.draggable  = true;
      handle.title      = "Drag to move";
      handle.innerHTML  = `
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="2.5"  r="1.5"/>
          <circle cx="7" cy="2.5"  r="1.5"/>
          <circle cx="3" cy="8"    r="1.5"/>
          <circle cx="7" cy="8"    r="1.5"/>
          <circle cx="3" cy="13.5" r="1.5"/>
          <circle cx="7" cy="13.5" r="1.5"/>
        </svg>`;
      wrapper.appendChild(handle);

      const dropLine = document.createElement("div");
      dropLine.className     = "pm-drop-line";
      dropLine.style.opacity = "0";
      wrapper.appendChild(dropLine);

      // ── Local state ─────────────────────────────────────────────────────────

      let hoveredPos  = null;   // offset of the top-level block under the mouse
      let draggedPos  = null;   // offset of the block being dragged (null = idle)
      let draggedDOM  = null;   // its DOM element (to apply faded style)

      // ── Helper: find which top-level block the pointer is over ───────────────

      function blockAtY(clientY) {
        let result = null;
        editorView.state.doc.forEach((node, offset) => {
          const dom = editorView.nodeDOM(offset);
          if (!(dom instanceof Element)) return;
          const r = dom.getBoundingClientRect();
          if (clientY >= r.top - 4 && clientY <= r.bottom + 4) result = offset;
        });
        return result;
      }

      // ── Helper: find the nearest gap between blocks for the drop position ───

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

      // ── Helper: show / hide the blue drop-line at a document position ────────

      function showDropLine(pos) {
        const { doc } = editorView.state;
        const wRect   = wrapper.getBoundingClientRect();
        let dom = null, atTop = false;

        doc.forEach((node, offset) => {
          if (offset === pos)                  { dom = editorView.nodeDOM(offset); atTop = true;  }
          if (offset + node.nodeSize === pos)  { dom = editorView.nodeDOM(offset); atTop = false; }
        });

        if (!(dom instanceof Element)) { dropLine.style.opacity = "0"; return; }
        const nRect = dom.getBoundingClientRect();
        const y     = (atTop ? nRect.top : nRect.bottom) - wRect.top;
        dropLine.style.top     = `${y}px`;
        dropLine.style.opacity = "1";
      }

      // ── Helper: dispatch the move transaction ─────────────────────────────────

      function moveBlock(from, to) {
        const { state } = editorView;
        const node = state.doc.nodeAt(from);
        if (!node) return;

        const size = node.nodeSize;
        // Skip if dropping at the same place or adjacent (no-op)
        if (to === from || to === from + size) return;

        let tr = state.tr;
        if (to < from) {
          // Moving UP: insert at target, then delete original (now shifted down)
          tr = tr.insert(to, node);
          tr = tr.delete(from + size, from + 2 * size);
        } else {
          // Moving DOWN: delete original, then insert at adjusted target
          tr = tr.delete(from, from + size);
          tr = tr.insert(to - size, node);
        }
        editorView.dispatch(tr.scrollIntoView());
      }

      // ── Mouse move on editor: track hovered block, reposition handle ─────────

      editorView.dom.addEventListener("mousemove", e => {
        if (draggedPos !== null) return; // don't repositon while dragging

        const pos = blockAtY(e.clientY);
        if (pos === null) { handle.style.opacity = "0"; return; }
        hoveredPos = pos;

        const dom = editorView.nodeDOM(pos);
        if (!(dom instanceof Element)) { handle.style.opacity = "0"; return; }

        const wRect = wrapper.getBoundingClientRect();
        const nRect = dom.getBoundingClientRect();

        handle.style.opacity = "1";
        handle.style.top  = `${nRect.top - wRect.top + nRect.height / 2 - 10}px`;
        handle.style.left = `${nRect.left - wRect.left - 28}px`;
      });

      editorView.dom.addEventListener("mouseleave", () => {
        if (draggedPos === null) handle.style.opacity = "0";
      });

      // ── Handle: drag start ────────────────────────────────────────────────────

      handle.addEventListener("dragstart", e => {
        if (hoveredPos === null) { e.preventDefault(); return; }

        draggedPos = hoveredPos;
        draggedDOM = editorView.nodeDOM(draggedPos);
        if (draggedDOM instanceof Element) draggedDOM.classList.add("pm-block-dragging");

        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "pm-block-drag");

        // Minimal ghost image so it doesn't obscure the drop target
        const ghost = document.createElement("div");
        ghost.style.cssText =
          "position:fixed;left:-9999px;padding:5px 12px;background:#1e293b;color:#fff;" +
          "border-radius:6px;font-size:12px;font-family:system-ui;white-space:nowrap";
        ghost.textContent = "Moving block…";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 60, 14);
        setTimeout(() => ghost.remove(), 0);
      });

      handle.addEventListener("dragend", () => {
        if (draggedDOM instanceof Element) draggedDOM.classList.remove("pm-block-dragging");
        draggedPos = null;
        draggedDOM = null;
        handle.style.opacity  = "0";
        dropLine.style.opacity = "0";
      });

      // ── Editor: dragover — show the drop-line indicator ───────────────────────

      editorView.dom.addEventListener("dragover", e => {
        if (draggedPos === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        showDropLine(dropPosAt(e.clientY));
      });

      editorView.dom.addEventListener("dragleave", () => {
        if (draggedPos !== null) dropLine.style.opacity = "0";
      });

      // ── Editor: drop — commit the move ────────────────────────────────────────

      editorView.dom.addEventListener("drop", e => {
        if (draggedPos === null) return;
        e.preventDefault();
        e.stopPropagation();

        const to = dropPosAt(e.clientY);
        dropLine.style.opacity = "0";

        // Execute move
        if (to !== null) moveBlock(draggedPos, to);

        if (draggedDOM instanceof Element) draggedDOM.classList.remove("pm-block-dragging");
        draggedPos = null;
        draggedDOM = null;
        handle.style.opacity = "0";
      });

      return {
        destroy() {
          handle.remove();
          dropLine.remove();
        },
      };
    },
  });
}
