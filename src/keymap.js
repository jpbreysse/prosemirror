/**
 * keymap.js
 *
 * Keyboard shortcuts for the editor.
 * Add or override bindings here as needed.
 */

import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands } from "prosemirror-commands";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { undo, redo } from "prosemirror-history";
import { schema } from "./schema.js";

function buildKeymap() {
  const { marks, nodes } = schema;

  return keymap({
    // History
    "Mod-z": undo,
    "Mod-y": redo,
    "Shift-Mod-z": redo,

    // Inline marks
    "Mod-b": toggleMark(marks.strong),
    "Mod-i": toggleMark(marks.em),
    "Mod-`": toggleMark(marks.code),

    // Block types
    "Shift-Ctrl-0": setBlockType(nodes.paragraph),
    "Shift-Ctrl-1": setBlockType(nodes.heading, { level: 1 }),
    "Shift-Ctrl-2": setBlockType(nodes.heading, { level: 2 }),
    "Shift-Ctrl-3": setBlockType(nodes.heading, { level: 3 }),

    // Lists — chainCommands tries splitListItem first, then falls through to
    // the base Enter so regular paragraphs still get a newline.
    "Enter": chainCommands(splitListItem(nodes.list_item), baseKeymap["Enter"]),
    "Tab": sinkListItem(nodes.list_item),
    "Shift-Tab": liftListItem(nodes.list_item),

    // Link — Cmd+K opens the toolbar popup by simulating a click on the 🔗 button.
    // The actual mark application lives in menu.js (needs a URL from the user).
    "Mod-k": (state, dispatch, view) => {
      const btn = document.querySelector("#toolbar button[title*='Link']");
      if (btn) { btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }
      return true;
    },

    // Blockquote
    "Ctrl->": wrapIn(nodes.blockquote),

    // Base bindings (Backspace, Delete, arrow keys, …)
    // Note: "Enter" is intentionally handled above via chainCommands.
    ...baseKeymap,
  });
}

export const editorKeymap = buildKeymap();
