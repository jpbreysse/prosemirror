export function insertImageBlock(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.imageBlock;
    if (!nodeType) return false;
    const node = nodeType.create(attrs);
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
