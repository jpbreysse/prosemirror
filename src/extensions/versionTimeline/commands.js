/**
 * commands.js — versionTimeline block
 *
 * Inserts a versionTimeline node at the current selection.
 */

export function insertVersionTimeline() {
  return (state, dispatch) => {
    const type = state.schema.nodes.versionTimeline;
    if (!type) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView());
    }
    return true;
  };
}
