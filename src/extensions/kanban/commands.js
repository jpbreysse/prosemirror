export function insertKanban(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.kanban;
    if (!nodeType) return false;
    const node = nodeType.create({ ...attrs });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
