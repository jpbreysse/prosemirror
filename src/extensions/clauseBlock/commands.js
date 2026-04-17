export function insertClauseBlock(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.clauseBlock;
    if (!nodeType) return false;
    const node = nodeType.create({ status: "search", ...attrs });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
