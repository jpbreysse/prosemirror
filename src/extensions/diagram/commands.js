/**
 * extensions/diagram/commands.js
 *
 * insertDiagram(attrs?) — inserts a diagram node at the current selection.
 */

export function insertDiagram(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.diagram;
    if (!nodeType) return false;

    const node = nodeType.create({
      nodes: [
        { id: "1", label: "Start",   x: 150, y: 80  },
        { id: "2", label: "Process", x: 150, y: 200 },
        { id: "3", label: "End",     x: 150, y: 320 },
      ],
      edges: [
        { id: "e1", source: "1", target: "2" },
        { id: "e2", source: "2", target: "3" },
      ],
      layout:  "preset",
      height:  400,
      caption: "",
      ...attrs,
    });

    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
