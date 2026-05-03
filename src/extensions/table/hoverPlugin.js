/**
 * extensions/table/hoverPlugin.js
 *
 * Notion-style hover UX on top of prosemirror-tables.
 *
 *         [× del]  [+ add]
 *    ┌─────────┬─────────┬─────────┐  [+ Add col]
 * ⊕× │  Col A  │  Col B  │  Col C  │
 *    ├─────────┼─────────┼─────────┤
 * ⊕× │  cell   │  cell   │  cell   │
 *    └─────────┴─────────┴─────────┘
 *    [+  Add row                    ]
 *
 *  ⊕  (left)  → insert row below
 *  ×  (right) → delete row
 *  [× del] / [+ add] → delete / add-after that column (hover header only)
 *  [+ Add col] → append a new column on the right
 *  [+ Add row] → append a new row at the bottom
 */

import { Plugin } from "prosemirror-state";
import { TableMap } from "prosemirror-tables";

// ── Low-level table helpers ─────────────────────────────────────────────────

/** Resolve absolute position of a cell node from an inside-cell pos. */
function resolveCellNode(state, cellContentPos) {
  const $pos = state.doc.resolve(cellContentPos);
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d).type.name;
    if (n === "table_cell" || n === "table_header") {
      return { cellPos: $pos.before(d), cellNode: $pos.node(d), depth: d };
    }
  }
  return null;
}

/** Find the table node and its absolute start for a cell content pos. */
function resolveTable(state, cellContentPos) {
  const $pos = state.doc.resolve(cellContentPos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") {
      return { tablePos: $pos.before(d), tableNode: $pos.node(d) };
    }
  }
  return null;
}

/** Column index of the cell at cellContentPos. Returns -1 if not found. */
function colIndexOfCell(state, cellContentPos) {
  const info = resolveTable(state, cellContentPos);
  if (!info) return -1;
  const { tablePos, tableNode } = info;
  const map = TableMap.get(tableNode);
  const cellInfo = resolveCellNode(state, cellContentPos);
  if (!cellInfo) return -1;
  const offset = cellInfo.cellPos - tablePos - 1; // relative to table content start
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (map.map[r * map.width + c] === offset) return c;
    }
  }
  return -1;
}

// ── Insert / delete operations ──────────────────────────────────────────────

/** Insert a blank row after the row that contains `cellContentPos`. */
function insertRowAfterPos(view, cellContentPos) {
  const state = view.state;
  const $cell = state.doc.resolve(cellContentPos);
  let tableStart = null, tableNode = null;
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === "table") {
      tableNode = $cell.node(d);
      tableStart = $cell.start(d);
      break;
    }
  }
  if (!tableNode) return;

  const map = TableMap.get(tableNode);
  const colCount = map.width;
  let targetRowIndex = 0, found = false;
  tableNode.forEach((rowNode, rowOffset, ri) => {
    if (found) return;
    rowNode.forEach((cellNode, cellOffset) => {
      if (found) return;
      const abs = tableStart + rowOffset + cellOffset + 1;
      if (Math.abs(abs - cellContentPos) <= cellNode.nodeSize) { targetRowIndex = ri; found = true; }
    });
  });

  const { table_row, table_cell, paragraph } = state.schema.nodes;
  const newRow = table_row.create(null,
    Array.from({ length: colCount }, () => table_cell.create(null, paragraph.create()))
  );
  let insertPos = tableStart;
  tableNode.forEach((rowNode, rowOffset, ri) => {
    if (ri <= targetRowIndex) insertPos = tableStart + rowOffset + rowNode.nodeSize;
  });
  view.dispatch(state.tr.insert(insertPos, newRow));
  view.focus();
}

/** Delete the row containing `cellContentPos`. Refuses if only one row left. */
function deleteRowAtPos(view, cellContentPos) {
  const state = view.state;
  const $cell = state.doc.resolve(cellContentPos);
  let rowDepth = -1;
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === "table_row") { rowDepth = d; break; }
  }
  if (rowDepth === -1) return;
  const tableNode = $cell.node(rowDepth - 1);
  if (tableNode.childCount <= 1) return; // last row — refuse
  const rowStart = $cell.before(rowDepth);
  const rowNode  = $cell.node(rowDepth);
  view.dispatch(state.tr.delete(rowStart, rowStart + rowNode.nodeSize));
  view.focus();
}

/** Append a new row at the very end of `tableEl`. */
function appendRow(view, tableEl) {
  const state = view.state;
  let tablePos = null;
  state.doc.descendants((node, pos) => {
    if (tablePos !== null) return false;
    if (node.type.name === "table" && view.nodeDOM(pos) === tableEl) { tablePos = pos; return false; }
  });
  if (tablePos === null) return;
  const tableNode = state.doc.nodeAt(tablePos);
  const colCount  = TableMap.get(tableNode).width;
  const { table_row, table_cell, paragraph } = state.schema.nodes;
  const newRow = table_row.create(null,
    Array.from({ length: colCount }, () => table_cell.create(null, paragraph.create()))
  );
  view.dispatch(state.tr.insert(tablePos + tableNode.nodeSize - 1, newRow));
  view.focus();
}

/** Append a new column at the very right of `tableEl`. */
function appendColumn(view, tableEl) {
  const state = view.state;
  let tablePos = null;
  state.doc.descendants((node, pos) => {
    if (tablePos !== null) return false;
    if (node.type.name === "table" && view.nodeDOM(pos) === tableEl) { tablePos = pos; return false; }
  });
  if (tablePos === null) return;
  const tableNode = state.doc.nodeAt(tablePos);
  const { table_cell, table_header, paragraph } = state.schema.nodes;
  const tr = state.tr;
  tableNode.forEach((row, rowOffset) => {
    const isHeader = row.firstChild?.type.name === "table_header";
    const newCell  = (isHeader ? table_header : table_cell).create(null, paragraph.create());
    const insertPos = tablePos + 1 + rowOffset + row.nodeSize - 1; // before row close
    tr.insert(tr.mapping.map(insertPos), newCell);
  });
  view.dispatch(tr);
  view.focus();
}

/**
 * Insert a column immediately AFTER the column that contains `cellContentPos`.
 */
function insertColumnAfterPos(view, cellContentPos) {
  const state = view.state;
  const info  = resolveTable(state, cellContentPos);
  if (!info) return;
  const { tablePos, tableNode } = info;
  const map = TableMap.get(tableNode);

  const colIndex = colIndexOfCell(state, cellContentPos);
  if (colIndex === -1) return;

  const { table_cell, table_header, paragraph } = state.schema.nodes;
  const tr = state.tr;

  // Process rows in reverse so earlier inserts don't shift later positions
  for (let r = map.height - 1; r >= 0; r--) {
    const cellOffset  = map.map[r * map.width + colIndex];
    const cellAbsPos  = tablePos + 1 + cellOffset;
    const cellNode    = state.doc.nodeAt(cellAbsPos);
    if (!cellNode) continue;
    const isHeader = cellNode.type.name === "table_header";
    const newCell  = (isHeader ? table_header : table_cell).create(null, paragraph.create());
    tr.insert(tr.mapping.map(cellAbsPos + cellNode.nodeSize), newCell);
  }
  view.dispatch(tr);
  view.focus();
}

/**
 * Delete the column that contains `cellContentPos`.
 * Refuses if it is the only column.
 */
function deleteColumnAtPos(view, cellContentPos) {
  const state = view.state;
  const info  = resolveTable(state, cellContentPos);
  if (!info) return;
  const { tablePos, tableNode } = info;
  const map = TableMap.get(tableNode);
  if (map.width <= 1) return; // last column — refuse

  const colIndex = colIndexOfCell(state, cellContentPos);
  if (colIndex === -1) return;

  const tr = state.tr;
  for (let r = map.height - 1; r >= 0; r--) {
    const cellOffset = map.map[r * map.width + colIndex];
    const cellAbsPos = tablePos + 1 + cellOffset;
    const cellNode   = state.doc.nodeAt(cellAbsPos);
    if (!cellNode) continue;
    tr.delete(tr.mapping.map(cellAbsPos), tr.mapping.map(cellAbsPos + cellNode.nodeSize));
  }
  view.dispatch(tr);
  view.focus();
}

// ── DOM helper ──────────────────────────────────────────────────────────────

function mkEl(tag, className, html, title) {
  const el = document.createElement(tag);
  el.className    = className;
  el.innerHTML    = html;
  if (title) el.title = title;
  el.style.display = "none";
  return el;
}

// ── Plugin ──────────────────────────────────────────────────────────────────

export function tableHoverPlugin() {
  return new Plugin({
    view(editorView) {
      const root = editorView.dom.closest("#app") ?? document.body;

      // Row controls
      const rowAddBtn = mkEl("button", "table-row-add-btn", "+",  "Insert row below");
      const rowDelBtn = mkEl("button", "table-row-del-btn", "×",  "Delete row");

      // Column controls (shown above the hovered column header)
      const colBar    = mkEl("div",    "table-col-bar",     "", "");
      colBar.innerHTML = `
        <button class="table-col-del-btn" title="Delete column">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span>Del col</span>
        </button>
        <button class="table-col-add-btn" title="Add column after">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span>Add col</span>
        </button>`;
      colBar.style.display = "none";

      // Edge bars
      const bottomBar = mkEl("button", "table-bottom-add-btn",
        `<span class="table-bottom-add-icon">+</span> Add row`, "Add row at end");
      const rightBtn  = mkEl("button", "table-right-add-btn",
        `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
           <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
         </svg> Add col`, "Add column at end");

      [rowAddBtn, rowDelBtn, colBar, bottomBar, rightBtn].forEach(el => root.appendChild(el));

      // State
      let activeRow   = null;
      let activeTable = null;
      let activeColEl = null;   // hovered <th> or <td>
      let rowCellPos  = null;
      let colCellPos  = null;

      // ── Positioning ──────────────────────────────────────────────

      function positionRowBtns(rowEl) {
        const rr = root.getBoundingClientRect();
        const rw = rowEl.getBoundingClientRect();
        const cy = rw.top - rr.top + rw.height / 2;
        const leftEdge = rw.left - rr.left;

        // Place both row controls side-by-side in the left gutter: [+] [×]
        rowAddBtn.style.top  = (cy - 10) + "px";
        rowAddBtn.style.left = (leftEdge - 48) + "px";
        rowAddBtn.style.display = "flex";

        rowDelBtn.style.top  = (cy - 10) + "px";
        rowDelBtn.style.left = (leftEdge - 24) + "px";
        rowDelBtn.style.display = "flex";
      }

      function positionColBar(cellEl) {
        const rr = root.getBoundingClientRect();
        const cr = cellEl.getBoundingClientRect();
        colBar.style.left    = (cr.left - rr.left) + "px";
        colBar.style.top     = (cr.top  - rr.top - 30) + "px";
        colBar.style.width   = cr.width + "px";
        colBar.style.display = "flex";
      }

      function positionBottomBar(tableEl) {
        const rr = root.getBoundingClientRect();
        const tr = tableEl.getBoundingClientRect();
        bottomBar.style.top   = (tr.bottom - rr.top - 14) + "px";
        bottomBar.style.left  = (tr.left   - rr.left)     + "px";
        bottomBar.style.width =  tr.width  + "px";
        bottomBar.style.display = "flex";
      }

      function positionRightBtn(tableEl) {
        const rr = root.getBoundingClientRect();
        const tr = tableEl.getBoundingClientRect();
        // Align with the first row (header) vertically
        const firstRow = tableEl.querySelector("tr");
        const fh = firstRow ? firstRow.getBoundingClientRect().height : 32;
        rightBtn.style.top    = (tr.top  - rr.top + (fh / 2) - 12) + "px";
        rightBtn.style.left   = (tr.right - rr.left + 6)            + "px";
        rightBtn.style.display = "flex";
      }

      function hideAll() {
        rowAddBtn.style.display = "none";
        rowDelBtn.style.display = "none";
        colBar.style.display    = "none";
        bottomBar.style.display = "none";
        rightBtn.style.display  = "none";
        activeRow = null; activeTable = null; activeColEl = null;
        rowCellPos = null; colCellPos = null;
      }

      function findCellPosInEl(tdOrTh) {
        try { return tdOrTh ? editorView.posAtDOM(tdOrTh, 0) : null; } catch { return null; }
      }

      // ── Events ───────────────────────────────────────────────────

      editorView.dom.addEventListener("mouseover", e => {
        const tableEl = e.target.closest("table");
        if (!tableEl) { hideAll(); return; }

        if (tableEl !== activeTable) {
          activeTable = tableEl;
          positionBottomBar(tableEl);
          positionRightBtn(tableEl);
        }

        const rowEl = e.target.closest("tr");
        if (rowEl && rowEl !== activeRow) {
          activeRow  = rowEl;
          rowCellPos = findCellPosInEl(rowEl.querySelector("td, th"));
          positionRowBtns(rowEl);
        }

        // Column controls — only show when hovering a <th>
        const cellEl = e.target.closest("th");
        if (cellEl && cellEl !== activeColEl) {
          activeColEl = cellEl;
          colCellPos  = findCellPosInEl(cellEl);
          positionColBar(cellEl);
        } else if (!cellEl && activeColEl) {
          activeColEl = null;
          colCellPos  = null;
          colBar.style.display = "none";
        }
      });

      editorView.dom.addEventListener("mouseleave", hideAll);

      // Keep overlays visible when mouse moves onto them
      function keepAlive(el) {
        el.addEventListener("mouseenter", () => {
          if (activeRow)   positionRowBtns(activeRow);
          if (activeTable) positionBottomBar(activeTable);
          if (activeTable) positionRightBtn(activeTable);
          if (activeColEl) positionColBar(activeColEl);
        });
        el.addEventListener("mouseleave", e => {
          const still = e.relatedTarget;
          const inTable = still?.closest("table");
          const inOverlay = still?.closest(
            ".table-row-add-btn, .table-row-del-btn, .table-col-bar, .table-bottom-add-btn, .table-right-add-btn"
          );
          if (!inTable && !inOverlay) hideAll();
        });
      }
      [rowAddBtn, rowDelBtn, colBar, bottomBar, rightBtn].forEach(keepAlive);

      // Prevent focus loss
      [rowAddBtn, rowDelBtn, colBar, bottomBar, rightBtn].forEach(el =>
        el.addEventListener("mousedown", e => e.preventDefault())
      );

      // Click handlers
      rowAddBtn.addEventListener("click", () => {
        if (rowCellPos !== null) insertRowAfterPos(editorView, rowCellPos);
      });
      rowDelBtn.addEventListener("click", () => {
        if (rowCellPos !== null) deleteRowAtPos(editorView, rowCellPos);
      });
      bottomBar.addEventListener("click", () => {
        if (activeTable) appendRow(editorView, activeTable);
      });
      rightBtn.addEventListener("click", () => {
        if (activeTable) appendColumn(editorView, activeTable);
      });
      colBar.querySelector(".table-col-del-btn").addEventListener("click", () => {
        if (colCellPos !== null) deleteColumnAtPos(editorView, colCellPos);
      });
      colBar.querySelector(".table-col-add-btn").addEventListener("click", () => {
        if (colCellPos !== null) insertColumnAfterPos(editorView, colCellPos);
      });

      return {
        update() {
          if (activeRow)   positionRowBtns(activeRow);
          if (activeTable) { positionBottomBar(activeTable); positionRightBtn(activeTable); }
          if (activeColEl) positionColBar(activeColEl);
        },
        destroy() {
          [rowAddBtn, rowDelBtn, colBar, bottomBar, rightBtn].forEach(el => el.remove());
        },
      };
    },
  });
}
