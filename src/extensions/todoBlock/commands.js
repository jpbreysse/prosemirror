/**
 * todoBlock/commands.js
 * Insert a fresh daily-todo block at the current cursor position.
 */

import { schema } from "../../schema.js";

const today = () => new Date().toISOString().slice(0, 10);

export function insertTodoBlock() {
  return (state, dispatch) => {
    const type = schema.nodes.todoBlock;
    if (!type) return false;
    if (dispatch) {
      const node = type.create({
        activeDate: today(),
        days: [{ date: today(), tasks: [] }],
      });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
