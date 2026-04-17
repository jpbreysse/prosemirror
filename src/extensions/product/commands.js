/**
 * extensions/product/commands.js
 *
 * insertProduct(attrs?) — inserts a product configurator node.
 */

export function insertProduct(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.product;
    if (!nodeType) return false;

    const node = nodeType.create({ ...attrs });

    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
