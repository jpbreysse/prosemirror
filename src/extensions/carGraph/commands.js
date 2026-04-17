export function insertCarGraph(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.carGraph;
    if (!nodeType) return false;
    const node = nodeType.create({
      title: 'EV-200 PHEV Drivetrain Architecture',
      ...attrs,
    });
    if (dispatch) {
      const pos = state.selection.$from.end(state.selection.$from.depth);
      dispatch(state.tr.insert(pos, node).scrollIntoView());
    }
    return true;
  };
}
