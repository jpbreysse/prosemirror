export function insertMarkdownBlock(content = "", filename = "") {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.markdownBlock;
    if (!nodeType) return false;
    const node = nodeType.create({ content, filename });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
