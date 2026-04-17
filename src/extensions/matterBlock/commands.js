export function insertMatterBlock(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.matterBlock;
    if (!nodeType) return false;
    const node = nodeType.create({ ...attrs, status: "search" });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
