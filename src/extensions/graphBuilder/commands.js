export function insertGraphBuilder(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.graphBuilder;
    if (!nodeType) return false;
    const node = nodeType.create({ title: "New Graph", ...attrs });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
