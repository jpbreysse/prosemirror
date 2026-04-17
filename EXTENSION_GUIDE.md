# Building an Extension — Developer Guide

This guide walks through building a new block extension from scratch.
Every extension in this codebase follows the same four-step pattern:
**Schema → NodeView → Command → Wiring**.

---

## Page 1 — Concepts & Schema

### How a custom block works

A custom block is a **ProseMirror node** rendered by a **NodeView**.
ProseMirror owns the document model (undo, copy/paste, persistence) and the
NodeView owns the DOM. They stay in sync through a simple contract:

```
Document (JSON)
      │  attrs are serialised as a single data-* attribute
      ▼
 NodeSpec   ←── schema.js registers the node type
      │
      ▼
 NodeView   ←── your class builds the DOM and dispatches updates
```

All state lives in **attrs** — plain JSON that ProseMirror stores, serialises,
and restores. The NodeView reads attrs on every `update()` call and re-renders.

---

### Step 1 — Add a node spec in `src/schema.js`

Every block needs a spec that tells ProseMirror its shape.

```js
// src/schema.js

const myWidgetNodeSpec = {
  group: "block",   // participates in the normal block flow
  atom: true,       // the cursor cannot enter it (most extensions use this)
  attrs: {
    title:   { default: "Untitled" },
    count:   { default: 0 },
    items:   { default: [] },         // arrays / objects are fine
  },
  // How to serialise to DOM (used by copy/paste and the reader page)
  toDOM(node) {
    return ["div", { "data-my-widget": JSON.stringify(node.attrs) }];
  },
  // How to parse back from DOM
  parseDOM: [{
    tag: "div[data-my-widget]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-my-widget")); }
      catch { return {}; }
    },
  }],
};
```

Then register it at the bottom of `schema.js`:

```js
const withCustom = withLists.append({
  // … existing nodes …
  myWidget: myWidgetNodeSpec,    // ← add this line
});
```

**Key rules**
- Always provide `default` for every attr — ProseMirror requires it.
- Use `atom: true` for self-contained blocks (chart, kanban, image…).
  Use `content: "paragraph+"` only when ProseMirror should manage inner text
  (see the `reply` node as an example).
- Keep attrs serialisable: strings, numbers, booleans, plain arrays/objects.
  No class instances, no DOM references.

---

## Page 2 — NodeView & Command

### Step 2 — Build the NodeView in `src/extensions/myWidget/nodeView.js`

The NodeView is a plain ES class with a small required interface.

```js
// src/extensions/myWidget/nodeView.js

export class MyWidgetNodeView {
  constructor(node, view, getPos) {
    this.node   = node;    // current ProseMirror Node object
    this.view   = view;    // the EditorView
    this.getPos = getPos;  // () => number — current document position

    // Create exactly one root DOM element; ProseMirror tracks it.
    this.dom = document.createElement("div");
    this.dom.className = "my-widget";

    this._build();
  }

  // ── The only way to write back to the document ─────────────────
  //
  // Call _patch() with a partial attrs object whenever the user
  // changes something. ProseMirror records it as a transaction
  // (undo-able, persisted, broadcast to collaborators).
  //
  _patch(patch) {
    const { state, dispatch } = this.view;
    dispatch(
      state.tr.setNodeMarkup(this.getPos(), null, {
        ...this.node.attrs,
        ...patch,
      })
    );
  }

  // ── Read-only detection ────────────────────────────────────────
  //
  // The reader page opens the editor with `editable: () => false`.
  // Check this before rendering interactive controls.
  //
  get _readonly() {
    return this.view.props.editable?.() === false;
  }

  // ── Render ────────────────────────────────────────────────────
  _build() {
    const { title, count } = this.node.attrs;
    this.dom.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = title;
    this.dom.appendChild(heading);

    if (!this._readonly) {
      const btn = document.createElement("button");
      btn.textContent = `Clicked ${count} times`;
      btn.addEventListener("click", () => {
        this._patch({ count: count + 1 });
      });
      this.dom.appendChild(btn);
    } else {
      const p = document.createElement("p");
      p.textContent = `${count} clicks`;
      this.dom.appendChild(p);
    }
  }

  // ── ProseMirror interface ──────────────────────────────────────

  // Called by ProseMirror when the node's attrs change (e.g. after
  // _patch, undo, or remote collaboration). Return true to accept
  // the update; false forces a full destroy+recreate.
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this._build();
    return true;
  }

  // Prevent ProseMirror from swallowing keyboard/mouse events that
  // belong to your widget's own UI.
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
}
```

---

### Step 3 — Write the insert command in `src/extensions/myWidget/commands.js`

A command is a function that returns a ProseMirror command: `(state, dispatch) => bool`.

```js
// src/extensions/myWidget/commands.js

export function insertMyWidget(attrs = {}) {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.myWidget;
    if (!nodeType) return false;                     // schema not registered

    const node = nodeType.create(attrs);             // create with defaults
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  };
}
```

To insert at an **explicit position** instead of the selection (useful when
one block spawns another, like subGraph does from carGraph):

```js
const insertPos = this.getPos() + this.node.nodeSize;  // just after current block
dispatch(state.tr.insert(insertPos, newNode).scrollIntoView());
```

---

## Page 3 — Wiring & Patterns

### Step 4 — Wire everything into the editor

**4a. Register the NodeView in `src/main.js`**

```js
// top of file — import
import { MyWidgetNodeView } from "./extensions/myWidget/nodeView.js";

// inside new EditorView(…) — nodeViews object
nodeViews: {
  // … existing nodeViews …
  myWidget: (node, view, getPos) => new MyWidgetNodeView(node, view, getPos),
},
```

**4b. Add a toolbar button in `src/menu.js`**

```js
// top of file — import the command
import { insertMyWidget } from "./extensions/myWidget/commands.js";

// inside the items array
button("🧩", "Insert My Widget", () => run(insertMyWidget())),
```

The `button()` helper fires on `mousedown` with `e.preventDefault()` so the
editor never loses focus. That's the correct pattern — do not use `click` for
toolbar buttons.

**4c. Register in `src/reader.js` (read-only page)**

The reader page needs the same NodeView list so custom blocks render correctly
in read mode. Add the same import and the same `nodeViews` entry there.

---

### Common patterns

**Functional patch with a callback**
When your patch depends on the current value of an array or object attr, use a
helper that takes a function:

```js
_patch(fn) {
  const { state, dispatch } = this.view;
  const next = fn(this.node.attrs);
  dispatch(state.tr.setNodeMarkup(this.getPos(), null, next));
}

// Usage:
this._patch(cur => ({ items: [...cur.items, newItem] }));
```

**Splitting rendering into sub-methods**
Large NodeViews use a `_build()` dispatcher that delegates to `_buildEmpty()`,
`_buildFilled()`, or named section renderers (`_renderHeader()`, `_renderBody()`, …).
Keep each method under ~40 lines.

**Expensive third-party libraries (Chart.js, Leaflet, Cytoscape)**
Create the library instance in the constructor and update it in `update()`
instead of destroying and recreating it on every change:

```js
constructor(node, view, getPos) {
  // …
  this._chart = new Chart(canvas, buildConfig(node.attrs));
}
update(node) {
  if (node.type !== this.node.type) return false;
  this.node = node;
  this._chart.data = newData(node.attrs);  // mutate in place
  this._chart.update();
  return true;
}
```

**Async operations (file upload, fetch)**
Run the async work outside ProseMirror, then call `_patch()` when done.
ProseMirror transactions are always synchronous; async is fine as long as
the patch happens at the end:

```js
async _load(url) {
  this._patch({ status: "loading" });
  try {
    const data = await fetch(url).then(r => r.json());
    this._patch({ status: "loaded", data });
  } catch {
    this._patch({ status: "error" });
  }
}
```

---

### Quick-reference checklist

| Step | File | What to add |
|------|------|-------------|
| 1 | `src/schema.js` | `myWidgetNodeSpec` constant + entry in `withCustom.append(…)` |
| 2 | `src/extensions/myWidget/nodeView.js` | `MyWidgetNodeView` class |
| 3 | `src/extensions/myWidget/commands.js` | `insertMyWidget()` function |
| 4a | `src/main.js` | Import + `nodeViews` entry |
| 4b | `src/menu.js` | Import command + toolbar `button(…)` |
| 4c | `src/reader.js` | Same import + `nodeViews` entry |

An extension with no external dependencies is typically **~120 lines total**
across the three files, split roughly 30 / 70 / 10 (schema / nodeView / commands).
