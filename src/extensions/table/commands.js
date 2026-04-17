/**
 * extensions/table/commands.js
 *
 * insertTable(rows, cols) — inserts an empty table at the current selection.
 * Re-exports prosemirror-tables commands for use in the menu.
 */

export {
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  deleteTable,
  toggleHeaderRow,
  toggleHeaderColumn,
  mergeCells,
  splitCell,
} from "prosemirror-tables";

export function insertTable(rows = 3, cols = 3) {
  return function (state, dispatch) {
    const { table, table_row, table_cell, table_header } = state.schema.nodes;
    if (!table) return false;

    // Build rows — first row uses header cells
    const tableRows = Array.from({ length: rows }, (_, r) =>
      table_row.create(null,
        Array.from({ length: cols }, () =>
          r === 0
            ? table_header.create(null, state.schema.nodes.paragraph.create())
            : table_cell.create(null, state.schema.nodes.paragraph.create())
        )
      )
    );

    const node = table.create(null, tableRows);

    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
