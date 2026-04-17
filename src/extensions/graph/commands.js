/**
 * extensions/graph/commands.js
 *
 * insertGraph(attrs?) — a ProseMirror command that inserts a graph node
 * at the current selection.
 *
 * Usage:
 *   insertGraph()(state, dispatch)             // default bar chart
 *   insertGraph({ chartType: "line" })(...)    // pre-configured
 */

import { schema } from "../../schema.js";

export function insertGraph(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.graph;
    if (!nodeType) return false; // schema doesn't have graph node

    const node = nodeType.create({
      chartType: "bar",
      title: "New Chart",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      data: [12, 19, 8, 22],
      color: "#6366f1",
      ...attrs,
    });

    if (dispatch) {
      // replaceSelectionWith inserts the node and moves the cursor after it
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
