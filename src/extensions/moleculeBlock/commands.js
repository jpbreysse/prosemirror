export function insertMoleculeBlock(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.moleculeBlock;
    if (!nodeType) return false;
    const node = nodeType.create(attrs);
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
