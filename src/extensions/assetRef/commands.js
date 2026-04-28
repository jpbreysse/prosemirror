/**
 * assetRef/commands.js
 *
 * ProseMirror command to insert an inline assetRef node.
 */

export function insertAssetRef(attrs = {}) {
  return (state, dispatch) => {
    const type = state.schema.nodes.assetRef;
    if (!type) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView());
    }
    return true;
  };
}
