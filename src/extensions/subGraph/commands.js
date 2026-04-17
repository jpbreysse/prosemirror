/**
 * subGraph/commands.js
 *
 * Inserts a SubGraph node at the current selection.
 * (The CarGraphNodeView uses a direct dispatch to insert after a specific position,
 *  but this export is available for other use cases.)
 */

export function insertSubGraph(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.subGraph;
    if (!nodeType) return false;
    const node = nodeType.create(attrs);
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
