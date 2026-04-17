/**
 * extensions/map/commands.js
 *
 * insertMap(attrs?) — inserts a map node at the current selection.
 *
 * Usage:
 *   insertMap()(state, dispatch)                        // Paris, zoom 13
 *   insertMap({ lat: 40.7128, lng: -74.0060 })(...)    // New York
 */

export function insertMap(attrs = {}) {
  return function (state, dispatch) {
    const nodeType = state.schema.nodes.map;
    if (!nodeType) return false;

    const node = nodeType.create({
      lat:     48.8566,
      lng:     2.3522,
      zoom:    13,
      height:  300,
      caption: "",
      ...attrs,
    });

    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
