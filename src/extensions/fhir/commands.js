/**
 * extensions/fhir/commands.js
 */
export function insertFhir(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.fhir;
    if (!nodeType) return false;
    const node = nodeType.create({ status: "idle", ...attrs });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
