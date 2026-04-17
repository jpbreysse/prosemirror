/**
 * extensions/reply/commands.js
 *
 * insertReply — inserts a reply block after the current block,
 * attributed to the current user stored in localStorage.
 */

import { TextSelection } from "prosemirror-state";
import { schema } from "../../schema.js";

// Deterministic color from author name
export function authorColor(name) {
  const palette = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
    "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

export function getCurrentUser() {
  return localStorage.getItem("pm_current_user") || "Anonymous";
}

export function setCurrentUser(name) {
  localStorage.setItem("pm_current_user", name);
}

export function insertReply() {
  return (state, dispatch) => {
    const author    = getCurrentUser();
    const color     = authorColor(author);
    const timestamp = new Date().toISOString();

    const replyNode = schema.nodes.reply.createAndFill(
      { author, color, timestamp },
      [schema.nodes.paragraph.create()]
    );
    if (!replyNode) return false;

    if (dispatch) {
      const { $from } = state.selection;
      // Insert after the current top-level block
      const insertPos = $from.depth > 0 ? $from.after(1) : $from.pos;
      const tr = state.tr.insert(insertPos, replyNode);
      // Move cursor to start of the new reply's content
      const cursorPos = insertPos + 2; // past the reply node's opening + header
      dispatch(
        tr.setSelection(TextSelection.create(tr.doc, cursorPos)).scrollIntoView()
      );
    }
    return true;
  };
}
