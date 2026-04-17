/**
 * insertAssetGraph — ProseMirror command
 *
 * Inserts an assetGraph node at the current cursor position.
 */
export function insertAssetGraph(attrs = {}) {
  return (state, dispatch) => {
    const { schema, selection: { $from } } = state;
    const nodeType = schema.nodes.assetGraph;
    if (!nodeType) return false;

    const node = nodeType.create({
      system: 'CW-101',
      title:  'Cooling Water System — CW-101',
      ...attrs,
    });

    if (dispatch) {
      const pos = $from.end($from.depth);
      dispatch(state.tr.insert(pos, node).scrollIntoView());
    }
    return true;
  };
}
