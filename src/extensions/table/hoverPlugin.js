/**
 * extensions/table/hoverPlugin.js
 *
 * Adds a Notion-style hover UX on top of prosemirror-tables:
 *
 *  ┌──────────────────────────────────┐
 *  │  Col A   │  Col B   │  Col C    │
 *  ├──────────────────────────────────┤
 * ⊕│  cell    │  cell    │  cell     │  ← row hover button
 *  ├──────────────────────────────────┤
 * ⊕│  cell    │  cell    │  cell     │
 *  └──────────────────────────────────┘
 *  [+  Add row                        ]  ← bottom bar
 *
 * Row button  → inserts a row AFTER the hovered row
 * Bottom bar  → inserts a row after the last row
 *
 * Both use mousedown + preventDefault so the editor never loses focus,
 * then resolve the correct document position before dispatching.
 */

import { Plugin } from "prosemirror-state";
import { TableMap } from "prosemirror-tables";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Insert a blank row after the row that contains `cellPos`. */
function insertRowAfterPos(view, cellPos) {
  const state = view.state;
  const $cell = state.doc.resolve(cellPos);

  // Walk up to find the table
  let tableStart = null;
  let tableNode  = null;
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === "table") {
      tableNode  = $cell.node(d);
      tableStart = $cell.start(d);
      break;
    }
  }
  if (!tableNode) return;

  const map      = TableMap.get(tableNode);
  const colCount = map.width;

  // Which row index is this cell in?
  const relPos  = cellPos - tableStart;
  const rowIndex = map.cellsInRect({ left: 0, right: map.width, top: 0, bottom: map.height })
    .findIndex(p => p >= relPos - 2 && p <= relPos + 2);

  // Simpler: find row index by walking table rows
  let targetRowIndex = 0;
  let found = false;
  tableNode.forEach((rowNode, rowOffset, ri) => {
    if (found) return;
    rowNode.forEach((cellNode, cellOffset) => {
      if (found) return;
      const absPos = tableStart + rowOffset + cellOffset + 1;
      if (Math.abs(absPos - cellPos) <= cellNode.nodeSize) {
        targetRowIndex = ri;
        found = true;
      }
    });
  });

  // Build a new empty row with the right number of cells
  const { table_row, table_cell, paragraph } = state.schema.nodes;
  const newRow = table_row.create(null,
    Array.from({ length: colCount }, () =>
      table_cell.create(null, paragraph.create())
    )
  );

  // Insert after the end of targetRowIndex
  let insertPos = tableStart;
  tableNode.forEach((rowNode, rowOffset, ri) => {
    if (ri <= targetRowIndex) insertPos = tableStart + rowOffset + rowNode.nodeSize;
  });

  view.dispatch(state.tr.insert(insertPos, newRow));
  view.focus();
}

/** Insert a blank row at the very end of the table. */
function appendRow(view, tableEl) {
  const state = view.state;

  // Find table position by matching DOM node
  let tablePos = null;
  state.doc.descendants((node, pos) => {
    if (tablePos !== null) return false;
    if (node.type.name === "table" && view.nodeDOM(pos) === tableEl) {
      tablePos = pos;
      return false;
    }
  });
  if (tablePos === null) return;

  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode) return;

  const map      = TableMap.get(tableNode);
  const colCount = map.width;
  const { table_row, table_cell, paragraph } = state.schema.nodes;

  const newRow   = table_row.create(null,
    Array.from({ length: colCount }, () =>
      table_cell.create(null, paragraph.create())
    )
  );

  const insertPos = tablePos + tableNode.nodeSize - 1; // before closing tag
  view.dispatch(state.tr.insert(insertPos, newRow));
  view.focus();
}

// ── Plugin ─────────────────────────────────────────────────────────────────

export function tableHoverPlugin() {
  return new Plugin({
    view(editorView) {
      const root = editorView.dom.closest("#app") ?? document.body;

      // ── Row "+" button ────────────────────────────────────────
      const rowBtn = document.createElement("button");
      rowBtn.className    = "table-row-add-btn";
      rowBtn.textContent  = "+";
      rowBtn.title        = "Insert row below";
      rowBtn.style.display = "none";
      root.appendChild(rowBtn);

      // ── Bottom "Add row" bar ──────────────────────────────────
      const bottomBar = document.createElement("button");
      bottomBar.className    = "table-bottom-add-btn";
      bottomBar.innerHTML    = `<span class="table-bottom-add-icon">+</span> Add row`;
      bottomBar.title        = "Add row at end";
      bottomBar.style.display = "none";
      root.appendChild(bottomBar);

      let activeRow   = null;   // currently hovered <tr>
      let activeTable = null;   // currently hovered <table>
      let rowCellPos  = null;   // PM position of a cell in activeRow

      // ── Position helpers ──────────────────────────────────────

      function positionRowBtn(rowEl) {
        const rootRect = root.getBoundingClientRect();
        const rowRect  = rowEl.getBoundingClientRect();
        // Place the button inside the left edge of the row (overlapping the table)
        rowBtn.style.top  = (rowRect.top  - rootRect.top  + rowRect.height / 2 - 10) + "px";
        rowBtn.style.left = (rowRect.left - rootRect.left + 6) + "px";
        rowBtn.style.display = "flex";
      }

      function positionBottomBar(tableEl) {
        const rootRect  = root.getBoundingClientRect();
        const tableRect = tableEl.getBoundingClientRect();
        // Overlap the bottom border of the table by half the bar's height
        bottomBar.style.top   = (tableRect.bottom - rootRect.top - 14) + "px";
        bottomBar.style.left  = (tableRect.left   - rootRect.left)     + "px";
        bottomBar.style.width = tableRect.width + "px";
        bottomBar.style.display = "flex";
      }

      function hideAll() {
        rowBtn.style.display    = "none";
        bottomBar.style.display = "none";
        activeRow   = null;
        activeTable = null;
        rowCellPos  = null;
      }

      // Find a PM cell position inside a given <tr>
      function findCellPosInRow(rowEl) {
        const tdOrTh = rowEl.querySelector("td, th");
        if (!tdOrTh) return null;
        const pos = editorView.posAtDOM(tdOrTh, 0);
        return pos;
      }

      // ── DOM events ────────────────────────────────────────────

      editorView.dom.addEventListener("mouseover", (e) => {
        const rowEl   = e.target.closest("tr");
        const tableEl = e.target.closest("table");

        if (!tableEl) { hideAll(); return; }

        // Update bottom bar whenever we enter a table
        if (tableEl !== activeTable) {
          activeTable = tableEl;
          positionBottomBar(tableEl);
        }

        // Update row button when row changes
        if (rowEl && rowEl !== activeRow) {
          activeRow  = rowEl;
          rowCellPos = findCellPosInRow(rowEl);
          positionRowBtn(rowEl);
        }
      });

      editorView.dom.addEventListener("mouseleave", () => hideAll());

      // Keep buttons visible when mouse moves onto them
      rowBtn.addEventListener("mouseenter", () => {
        if (activeRow) positionRowBtn(activeRow);
      });
      rowBtn.addEventListener("mouseleave", (e) => {
        if (!e.relatedTarget?.closest("table") &&
            !e.relatedTarget?.closest(".table-bottom-add-btn")) hideAll();
      });

      bottomBar.addEventListener("mouseenter", () => {
        if (activeTable) positionBottomBar(activeTable);
      });
      bottomBar.addEventListener("mouseleave", (e) => {
        if (!e.relatedTarget?.closest("table") &&
            !e.relatedTarget?.closest(".table-row-add-btn")) hideAll();
      });

      // ── Click handlers ────────────────────────────────────────

      rowBtn.addEventListener("mousedown",    e => e.preventDefault());
      bottomBar.addEventListener("mousedown", e => e.preventDefault());

      rowBtn.addEventListener("click", () => {
        if (rowCellPos !== null) insertRowAfterPos(editorView, rowCellPos);
      });

      bottomBar.addEventListener("click", () => {
        if (activeTable) appendRow(editorView, activeTable);
      });

      // ── Plugin view interface ─────────────────────────────────

      return {
        update() {
          // Reposition if the table moves (e.g. after a row was inserted)
          if (activeRow)   positionRowBtn(activeRow);
          if (activeTable) positionBottomBar(activeTable);
        },
        destroy() {
          rowBtn.remove();
          bottomBar.remove();
        },
      };
    },
  });
}
