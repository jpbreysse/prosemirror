# Document Relationship Graph

> **Feature:** `pm_document_link` — typed directed links between documents  
> **Status:** Implemented (CRUD + 1-hop queries). Multi-hop traversal and visual graph view not yet built.

---

## Table of Contents

1. [Concept](#concept)
2. [Data Model](#data-model)
3. [Edge Types](#edge-types)
4. [Use Cases](#use-cases)
5. [Implementation](#implementation)
6. [Current Limitations](#current-limitations)
7. [Next Steps](#next-steps)

---

## Concept

Every document in the system is a **node**. A `pm_document_link` row is a **directed edge** between two nodes, labelled with a semantic type.

```
Doc A  ──[supersedes]──►  Doc B
Doc C  ──[implements]──►  Doc A
Doc D  ──[references]──►  Doc A
```

This turns a flat list of documents into a **navigable knowledge graph** — where relationships between documents are explicit, queryable, and visible to any reader.

The primary motivation is that in any serious body of work — a consulting engagement, a technical project, a legal matter — documents do not exist in isolation. A report is based on workshop notes. A spec is implemented by a design document. An old procedure is replaced by a revised one. Without explicit links, those relationships exist only in the author's head and are lost the moment they leave the project.

---

## Data Model

### Table: `pm_document_link`

```sql
CREATE TABLE pm_document_link (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_doc   TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
  to_doc     TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
  link_type  TEXT        NOT NULL
             CHECK (link_type IN ('references','supersedes','superseded_by',
                                   'implements','closes')),
  from_title TEXT        NOT NULL DEFAULT '',
  to_title   TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pm_document_link_no_self  CHECK (from_doc <> to_doc),
  CONSTRAINT pm_document_link_unique   UNIQUE (from_doc, to_doc, link_type)
);

CREATE INDEX pm_document_link_from_idx ON pm_document_link (from_doc);
CREATE INDEX pm_document_link_to_idx   ON pm_document_link (to_doc);
```

### Conceptual mapping

| Graph concept | Implementation |
|---|---|
| Node | Row in `pm_documents` |
| Edge | Row in `pm_document_link` |
| Edge direction | `from_doc` → `to_doc` |
| Edge label | `link_type` |
| Node identity | `id TEXT` (client-generated UUID) |

### Cached titles

`from_title` and `to_title` store the document titles **at the time the link is created**. This allows the Related Documents section to render without fetching both documents on every page load.

> **Important:** these cached values are never updated. If a document is renamed after a link is created, the cached title becomes stale. The link itself remains valid — only the display label is wrong.

---

## Edge Types

### Overview

| Type | Direction | User-creatable | Auto-inverse |
|---|---|---|---|
| `references` | A → B | Yes | No |
| `supersedes` | A → B | Yes | **Yes** → creates `superseded_by` |
| `superseded_by` | B → A | No (auto-only) | **Yes** → creates `supersedes` |
| `implements` | A → B | Yes | No |
| `closes` | A → B | Yes | No |

`superseded_by` is the only type that cannot be chosen by the user. It is always created automatically as the inverse of `supersedes`, in the same database transaction.

### Symmetry rules

```
User creates:    A ──[supersedes]──► B
Auto-created:    B ──[superseded_by]──► A

User deletes:    A ──[supersedes]──► B
Auto-deleted:    B ──[superseded_by]──► A
```

Both operations happen inside a `BEGIN / COMMIT` transaction. If either insert/delete fails, the whole operation rolls back, so the two sides are always consistent.

---

## Use Cases

### 1. Supersedes — Version control for prose documents

**Problem:** Documents get revised. Without an explicit link, old and new versions coexist silently. Readers have no way to know which one is current.

**Solution:** When a revised document is published, link it to its predecessor with `supersedes`.

```
"Cooling Water Procedure v2"  ──[supersedes]──►  "Cooling Water Procedure v1"
```

- Opening **v1** shows: *"Superseded by: Cooling Water Procedure v2"* — the reader knows immediately not to follow it.
- Opening **v2** shows: *"Supersedes: Cooling Water Procedure v1"* — full audit trail of what was replaced.

**Context where this matters most:**
- Safety and operating procedures that are periodically revised
- Policy documents with compliance implications
- Consultant deliverables that go through multiple iterations

---

### 2. References — Traceability from output back to source

**Problem:** A report or decision was produced based on other documents. Without explicit links, the reasoning is opaque and cannot be verified or audited.

**Solution:** Link every output to the inputs it was based on with `references`.

```
"Phase 2 Assessment Report"  ──[references]──►  "W2 IT Landscape Baseline"
"Phase 2 Assessment Report"  ──[references]──►  "W3 Invoice Process Notes"
"Architecture Decision — Queue"  ──[references]──►  "System Requirements v3"
```

When a source document is updated, you can find everything that referenced it and flag those documents for review.

**Context where this matters most:**
- Consulting deliverables that synthesise multiple workshop outputs
- Architecture decisions grounded in requirements
- Any audit where you need to show "where did this conclusion come from?"

---

### 3. Implements — Close the loop between spec and execution

**Problem:** A specification is written but nobody tracks whether it was ever acted on. Six months later it is unclear if the spec is aspirational or describes what was actually built.

**Solution:** When an implementation document is created, link it back to the spec with `implements`.

```
"OAuth Integration Spec"  ◄──[implements]──  "OAuth Developer Notes"
"Data Retention Policy"   ◄──[implements]──  "Data Retention Procedure"
```

Opening the spec, the reader sees under *"Linked from other documents"*: `[Implements] OAuth Developer Notes`. The spec is no longer a dead end.

**Context where this matters most:**
- Technical specs paired with design or developer notes
- Policy documents paired with operating procedures
- Roadmap items paired with delivery notes

---

### 4. Closes — Link problems to their resolutions

**Problem:** A document surfaces a risk, issue, or gap. A later document addresses it. Without a link, the resolution is invisible from the problem document.

**Solution:** Link the resolution back to the problem with `closes`.

```
"Risk Matrix — Thermal Runaway Cell Block C3"  ◄──[closes]──  "Remediation Plan — Cooling Upgrade"
"W1 Pain Point — Knowledge Loss on Project Close"  ◄──[closes]──  "Knowledge Management Proposal"
```

Anyone reading the risk document sees it has been addressed, and who addressed it.

**Context where this matters most:**
- Risk registers and their mitigations
- Workshop findings and their follow-up deliverables
- Audit findings and their corrective actions

---

### 5. The full lifecycle chain

The real power emerges when link types are combined across a project. Consider a full Lummus engagement:

```
W1 Workshop Notes
  └──[closes]──► Knowledge Management Proposal
                    └──[implements]──► KM System Architecture
                                          ├──[references]──► IT Landscape Baseline (W2)
                                          └──[supersedes]──► Previous KM Approach Doc
```

Opening any document in this chain gives the full context: where the work came from, what it produced, what it replaced, and what it is grounded in. A new team member joining mid-engagement can reconstruct the reasoning without asking anyone.

---

## Implementation

### Backend — `server.js`

Three REST endpoints:

#### `GET /api/docs/:id/links`

Returns both directions in a single call. Two parallel `SELECT` queries, no recursive JOIN:

```js
const [out, inc] = await Promise.all([
  pool.query(
    `SELECT id, from_doc, to_doc, link_type, from_title, to_title, created_at
     FROM pm_document_link WHERE from_doc = $1 ORDER BY created_at ASC`,
    [id]
  ),
  pool.query(
    `SELECT id, from_doc, to_doc, link_type, from_title, to_title, created_at
     FROM pm_document_link WHERE to_doc = $1 ORDER BY created_at ASC`,
    [id]
  ),
]);
res.json({ outgoing: out.rows, incoming: inc.rows });
```

Response shape:
```json
{
  "outgoing": [
    { "id": "uuid", "to_doc": "doc-b", "link_type": "references", "to_title": "Spec v2" }
  ],
  "incoming": [
    { "id": "uuid", "from_doc": "doc-c", "link_type": "implements", "from_title": "Feature X" }
  ]
}
```

#### `POST /api/docs/:id/links`

Body: `{ to_doc, link_type, from_title?, to_title? }`

Validates:
- `to_doc` is present
- `to_doc !== from_doc` (no self-links)
- `link_type` is in the allowed set

For `supersedes`, runs the auto-inverse inside a transaction:

```js
await client.query('BEGIN');

// Forward link
INSERT INTO pm_document_link (from_doc, to_doc, link_type, from_title, to_title)
VALUES ($fromDoc, $toDoc, 'supersedes', $fromTitle, $toTitle)
ON CONFLICT (from_doc, to_doc, link_type) DO UPDATE
  SET from_title = EXCLUDED.from_title, to_title = EXCLUDED.to_title

// Automatic inverse
INSERT INTO pm_document_link (from_doc, to_doc, link_type, from_title, to_title)
VALUES ($toDoc, $fromDoc, 'superseded_by', $toTitle, $fromTitle)
ON CONFLICT (from_doc, to_doc, link_type) DO NOTHING

await client.query('COMMIT');
```

#### `DELETE /api/docs/:id/links/:linkId`

Fetches the link first (must belong to the calling doc on either side), then deletes it and its inverse in a transaction:

```js
await client.query('BEGIN');
DELETE FROM pm_document_link WHERE id = $linkId;
// For supersedes/superseded_by — delete the other side too
DELETE FROM pm_document_link
WHERE from_doc = $link.to_doc AND to_doc = $link.from_doc AND link_type = 'superseded_by';
await client.query('COMMIT');
```

---

### Frontend — `src/docLinks.js`

Two components: a **section renderer** and a **picker modal**.

#### Section renderer

Mounts into a container element (the editor rail or the reader footer). Fetches links, then renders two groups:

```
Related documents (3)                              [+ Add link]

From this document
  [Supersedes]   Cooling Water Procedure v1        [unlink]
  [References]   W2 IT Landscape Baseline          [unlink]

Linked from other documents
  [Implements]   Cooling System Dev Notes
```

Rules:
- **Outgoing links** show an `[unlink]` button (editor mode only)
- **Incoming links** never show an unlink button — you can only remove a link from the document that created it
- In `readOnly` mode (reader.html), no add or unlink controls are shown

#### Picker modal

Opened by "+ Add link". Two inputs:
1. `<select>` for link type — only the 4 user-creatable types (`superseded_by` is excluded)
2. A debounced search field (220ms) hitting `GET /api/docs?search=…&limit=20`

The search excludes the current document and any document already linked. Clicking a result immediately calls `POST`, closes the modal, and re-renders the section.

#### Where it is mounted

| Surface | File | Mode |
|---|---|---|
| Editor right rail | `main.js` | Read/write |
| Reader footer | `reader.js` | Read-only |

---

## Current Limitations

### 1. One-hop only

The API returns only **direct neighbours**. Given:

```
A ──[supersedes]──► B ──[references]──► C ──[implements]──► D
```

Opening document A shows B. Opening B shows A and C. There is no single query that returns the full chain from A to D.

### 2. Stale cached titles

`from_title` and `to_title` are written once at link creation and never updated. Renaming a document after linking it will show the old name in all related document sections.

### 3. No validation against the document graph

You can create logically inconsistent links. For example:
- A `supersedes` B, and B `supersedes` A (a cycle)
- A `closes` B, but B is a workshop notes doc and A is a BOM — the types are semantically wrong

The database only enforces the `link_type` enum and the no-self-link constraint. There is no semantic validation.

### 4. Link types are hardcoded

Adding a new edge type (e.g. `blocks`, `depends_on`, `related_to`) requires a code change in three places: the `CHECK` constraint in the database, the `VALID_LINK_TYPES` set in `server.js`, and the `LINK_LABELS` / `CREATABLE_LINK_TYPES` constants in `docLinks.js`.

### 5. No graph visualisation

The relationship graph exists in the database but there is no visual representation. Users navigate it one document at a time, by clicking individual links in the Related Documents section.

### 6. No search or filter across links

There is no way to ask cross-document questions such as:
- "Show me all documents that nothing supersedes yet" (potential outdated docs)
- "Show me all unresolved risk documents" (no `closes` link pointing at them)
- "Show me the full dependency tree of this spec"

---

## Next Steps

### Short term — fix existing gaps

**1. Fix stale cached titles**

On every `PUT /api/docs/:id` (document save), update cached titles in all existing links:

```sql
UPDATE pm_document_link
SET from_title = $newTitle
WHERE from_doc = $docId AND from_title != $newTitle;

UPDATE pm_document_link
SET to_title = $newTitle
WHERE to_doc = $docId AND to_title != $newTitle;
```

**2. Configurable link types**

Move link types into a `pm_link_types` table (`key TEXT PK`, `label TEXT`, `inverse_of TEXT`, `user_creatable BOOLEAN`). This allows adding new relationship types at runtime without code changes.

---

### Medium term — multi-hop traversal

Add a `GET /api/docs/:id/graph?depth=N` endpoint using PostgreSQL's native `WITH RECURSIVE`:

```sql
WITH RECURSIVE graph AS (
  -- Seed: direct neighbours of the starting document
  SELECT
    from_doc,
    to_doc,
    link_type,
    from_title,
    to_title,
    1 AS depth,
    ARRAY[from_doc] AS visited   -- cycle guard
  FROM pm_document_link
  WHERE from_doc = $startId

  UNION ALL

  -- Recurse: follow outgoing edges from each reached node
  SELECT
    l.from_doc,
    l.to_doc,
    l.link_type,
    l.from_title,
    l.to_title,
    g.depth + 1,
    g.visited || l.from_doc
  FROM pm_document_link l
  JOIN graph g ON l.from_doc = g.to_doc
  WHERE g.depth < $maxDepth
    AND NOT (l.to_doc = ANY(g.visited))   -- break cycles
)
SELECT * FROM graph;
```

This requires **no schema changes** — it runs on the existing `pm_document_link` table.

The response would be a flat list of edges from which the client can reconstruct the full subgraph:

```json
{
  "nodes": [
    { "id": "doc-a", "title": "W1 Notes" },
    { "id": "doc-b", "title": "KM Proposal" },
    { "id": "doc-c", "title": "KM Architecture" }
  ],
  "edges": [
    { "from": "doc-a", "to": "doc-b", "type": "closes" },
    { "from": "doc-b", "to": "doc-c", "type": "implements" }
  ]
}
```

---

### Long term — visual knowledge graph

Render the document graph as an interactive diagram using **Cytoscape.js**, which is already a dependency of the project (used by the `diagram` block node view).

The graph view would:
- Show documents as nodes, styled by type (meeting notes, spec, report, etc.)
- Show edges as coloured arrows, labelled by link type
- Allow clicking a node to open the document
- Allow dragging to explore large graphs
- Be accessible from the main document list (`docs.html`) as a toggle: "List view" / "Graph view"

This would effectively turn the document library into an Obsidian-style knowledge graph, where the structure of an entire engagement or project is visible at once.

```
Toolbar:  [List]  [Graph]  ← toggle on docs.html

              ┌─────────────────────────────────────────────┐
              │                                             │
              │   [W1 Notes] ──closes──► [KM Proposal]     │
              │                              │              │
              │                         implements          │
              │                              │              │
              │   [IT Baseline] ─ref─► [KM Architecture]   │
              │                              │              │
              │                         supersedes          │
              │                              │              │
              │                      [Old KM Approach]      │
              │                                             │
              └─────────────────────────────────────────────┘
```

---

## Summary

| Aspect | Current state |
|---|---|
| Data model | ✅ Directed graph in PostgreSQL (`pm_document_link`) |
| Edge types | ✅ 5 types; `supersedes` auto-inversed |
| CRUD API | ✅ GET / POST / DELETE under `/api/docs/:id/links` |
| UI | ✅ "Related documents" section in editor rail and reader |
| Multi-hop traversal | ❌ Not implemented (PostgreSQL `WITH RECURSIVE` ready) |
| Visual graph view | ❌ Not implemented (Cytoscape.js already available) |
| Stale title fix | ❌ Not implemented |
| Configurable link types | ❌ Hardcoded |
| Cycle / semantic validation | ❌ Not implemented |
