# LexDocs — Technical Reference

> **Stack:** Vanilla JS + Vite (frontend) · Express 5 (API) · PostgreSQL (persistence)
> **API base:** `http://localhost:3001`
> **Dev frontend:** `http://localhost:5173`

---

## Table of contents

1. [API endpoints](#api-endpoints)
2. [Database schema](#database-schema)
3. [Extensions](#extensions)
4. [Connectors](#connectors)
5. [Audit log](#audit-log)

---

## API endpoints

### Documents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/docs` | List all documents. Returns `[{ id, title, tags, created_at, updated_at }]` |
| `GET` | `/api/docs/stats` | Aggregate stats: `{ total_docs, active_this_week, created_this_month, total_bytes, total_versions }` |
| `GET` | `/api/docs/:id` | Fetch one document. Returns full row including `content` (ProseMirror JSON) |
| `POST` | `/api/docs` | Create a document. Body: `{ id, content, title }`. Idempotent (ON CONFLICT DO NOTHING) |
| `PUT` | `/api/docs/:id` | Upsert a document. Body: `{ content, title }`. Also syncs `pm_asset_document_mention` |
| `DELETE` | `/api/docs/:id` | Delete a document and all cascaded rows |
| `PUT` | `/api/docs/:id/tags` | Replace tag list. Body: `{ tags: string[] }` |

### Document versions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/docs/:id/versions` | List all saved versions (metadata only, no content) |
| `GET` | `/api/docs/:id/versions/:versionId` | Fetch one version with full content |
| `POST` | `/api/docs/:id/versions` | Save a named snapshot. Body: `{ label }` |
| `DELETE` | `/api/docs/:id/versions/:versionId` | Delete a version |

### Collections

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/collections` | List collections with `doc_count` |
| `POST` | `/api/collections` | Create. Body: `{ name, color }` |
| `PUT` | `/api/collections/:id` | Rename / recolor. Body: `{ name?, color? }` |
| `DELETE` | `/api/collections/:id` | Delete (cascade removes membership rows) |
| `POST` | `/api/collections/:id/docs` | Add a document. Body: `{ docId }` |
| `DELETE` | `/api/collections/:id/docs/:docId` | Remove a document from the collection |

### Extensions config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/extensions/config` | Returns `{ graph: true, kanban: true, assetRef: true, … }` |
| `PUT` | `/api/extensions/config` | Toggle one extension. Body: `{ key, enabled }` |

### Asset references

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/asset-mentions?assetId=<uuid>` | All documents that mention this asset. Returns `[{ document_id, title, tag, display, mention_count, last_seen_at }]` |
| `GET` | `/api/asset-mentions?docId=<id>` | All assets mentioned in a document. Returns `[{ asset_id, tag, display, mention_count, first_seen_at, last_seen_at }]` |

### Connectors

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/connectors` | List all connectors (auth_value redacted) |
| `POST` | `/api/connectors` | Register a connector. Body: `{ name, label, base_url, auth_type, auth_header, auth_value, path_prefix }` |
| `PUT` | `/api/connectors/:name` | Update connector settings |
| `DELETE` | `/api/connectors/:name` | Remove a connector |
| `ANY` | `/api/connect/:name/*path` | Generic proxy. Forwards the request to `base_url + path_prefix + /path` with auth headers injected |

### File upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Multipart upload. Field: `file`. Returns `{ url }` (served from `/uploads/`) |

### Maintenance & IoT (demo)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/maintenance` | List maintenance records joined with IoT sensor readings |
| `GET` | `/api/iot/sensors` | Mock real-time sensor data |
| `GET` | `/api/query/critical-machines` | Cross-system JOIN: maintenance × IoT × criticality |

### Engagement (LCI workshops)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/engagement/workshops` | List all workshops with question counts |
| `PUT` | `/api/engagement/workshops/:id` | Update workshop status / metadata |
| `GET` | `/api/engagement/participants` | List all participants |
| `POST` | `/api/engagement/participants` | Create participant |
| `PUT` | `/api/engagement/participants/:id` | Update participant |
| `DELETE` | `/api/engagement/participants/:id` | Delete participant |
| `GET` | `/api/engagement/questions?workshopId=` | List questions for a workshop |
| `POST` | `/api/engagement/questions` | Add a question |
| `PUT` | `/api/engagement/questions/:id` | Update question text / order |
| `DELETE` | `/api/engagement/questions/:id` | Delete question |

### Audit log

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit-log` | Query log. Filters: `method`, `path`, `status`, `from`, `to`, `limit`, `offset` |
| `DELETE` | `/api/audit-log` | Clear all log entries |

---

## Database schema

All tables live in the same PostgreSQL database, prefixed `pm_` (platform) or `lci_` (engagement module).

### `pm_documents`

The primary content store. `id` is a client-generated UUID string (TEXT), not a serial.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` PK | UUID generated client-side via `crypto.randomUUID()` |
| `content` | `JSONB` | Full ProseMirror document JSON |
| `title` | `TEXT` | Auto-extracted from the first heading node |
| `tags` | `TEXT[]` | Free-form tag array |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Refreshed on every PUT |

### `pm_document_versions`

Named snapshots of a document. Kept indefinitely until manually deleted.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | |
| `doc_id` | `TEXT` | FK → `pm_documents(id)` ON DELETE CASCADE |
| `version_num` | `INT` | Auto-incremented per document |
| `label` | `TEXT` | User-supplied name |
| `content` | `JSONB` | Snapshot of the ProseMirror JSON at save time |
| `created_at` | `TIMESTAMPTZ` | |

### `pm_collections`

Named groups of documents with a display colour.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | |
| `name` | `TEXT` | |
| `color` | `TEXT` | Hex colour string, default `#6366f1` |
| `created_at` | `TIMESTAMPTZ` | |

### `pm_collection_docs`

Many-to-many join between collections and documents.

| Column | Type | Notes |
|--------|------|-------|
| `collection_id` | `UUID` | FK → `pm_collections(id)` ON DELETE CASCADE |
| `doc_id` | `TEXT` | FK → `pm_documents(id)` ON DELETE CASCADE |
| `added_at` | `TIMESTAMPTZ` | |
| **PK** | `(collection_id, doc_id)` | |

### `pm_connectors`

Registry of external systems that can be proxied via `/api/connect/:name/*`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | |
| `name` | `TEXT` UNIQUE | URL slug, e.g. `asset-registry` |
| `label` | `TEXT` | Display name |
| `base_url` | `TEXT` | e.g. `http://localhost:5177` |
| `auth_type` | `TEXT` | `api_key` · `bearer` · `basic` · `none` |
| `auth_header` | `TEXT` | e.g. `X-API-Key` |
| `auth_value` | `TEXT` | Secret — store encrypted in production |
| `path_prefix` | `TEXT` | Prepended to every proxied path, e.g. `/api` |
| `enabled` | `BOOLEAN` | Disabled connectors are refused by the proxy |
| `created_at` | `TIMESTAMPTZ` | |

**Seeded connectors:**

| name | label | default base_url |
|------|-------|-----------------|
| `crm` | CRM | `http://localhost:3002` |
| `lex` | LexAPI | `http://localhost:3003` |
| `asset-registry` | Asset Registry | `http://localhost:5177` |

### `pm_extension_config`

Feature-flag table. One row per extension key. Missing keys default to enabled.

| Column | Type | Notes |
|--------|------|-------|
| `key` | `TEXT` PK | Extension identifier, e.g. `assetRef` |
| `enabled` | `BOOLEAN` | |

### `pm_asset_document_mention`

Pre-computed index of which assets are referenced in which documents.
Updated automatically on every `PUT /api/docs/:id` save.
Enables reverse lookups from the Asset Registry without scanning document content.

| Column | Type | Notes |
|--------|------|-------|
| `document_id` | `TEXT` | FK → `pm_documents(id)` ON DELETE CASCADE |
| `asset_id` | `TEXT` | UUID from external Asset Registry — **no FK** (external system) |
| `tag` | `TEXT` | Denormalised tag at time of save, e.g. `P-101A` |
| `display` | `TEXT` | Denormalised display string, e.g. `P-101A (Cooling water pump A)` |
| `mention_count` | `INT` | Times the asset appears in this document |
| `first_seen_at` | `TIMESTAMPTZ` | |
| `last_seen_at` | `TIMESTAMPTZ` | Updated on every save |
| **PK** | `(document_id, asset_id)` | |
| **Index** | `asset_id` | Fast lookup: "all docs mentioning asset X" |

### `pm_audit_log`

Append-only record of every `/api/*` request. Written after the response, non-blocking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | |
| `ts` | `TIMESTAMPTZ` | Indexed DESC |
| `method` | `TEXT` | `GET` · `POST` · `PUT` · `DELETE` |
| `path` | `TEXT` | e.g. `/api/docs/abc123` |
| `status` | `INT` | HTTP response code |
| `duration_ms` | `INT` | Server-side response time |
| `ip` | `TEXT` | First IP from `X-Forwarded-For` |
| `user_agent` | `TEXT` | |
| `body_size` | `INT` | Bytes from `Content-Length` header |

### `lci_workshops` / `lci_participants` / `lci_questions`

Engagement planning tables for the LCI workshop module (Phase 2). Seeded with four workshops (W1–W4), standard participant roles, and 36 facilitation questions.

---

## Extensions

Extensions are ProseMirror NodeViews registered in `src/main.js` and toggled via `pm_extension_config`. Each lives in `src/extensions/<name>/` with two files: `commands.js` (insert command) and `nodeView.js` (DOM renderer).

Enabled/disabled via `PUT /api/extensions/config { key, enabled }` or through `extensions.html`.

### `assetRef` — Asset Reference

An **inline atom node** that embeds a reference to an asset from the external Asset Registry directly inside document text. Renders as a clickable chip.

**Node type:** `assetRef`
**Category:** inline (lives inside paragraphs, not as a standalone block)

#### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `assetId` | `string` | UUID of the asset in the Asset Registry |
| `tag` | `string` | Asset tag code, e.g. `P-101A` |
| `display` | `string` | Human-readable label, e.g. `P-101A (Cooling water pump A)` |

#### ProseMirror JSON representation

```json
{
  "type": "assetRef",
  "attrs": {
    "assetId": "55799181-1dd7-4d09-a406-5ea5c9aaa6fe",
    "tag":     "P-101A",
    "display": "P-101A (Cooling water pump A)"
  }
}
```

#### Rendered chip

```
[ ⚙  P-101A   Cooling water pump A  ↗ ]
```

Clicking the chip opens `http://localhost:5177/assets/<assetId>` in a new tab.

#### Inserting an asset reference

Click the **⚙** toolbar button (requires `assetRef` extension to be enabled). A search modal opens:

1. Type a tag or asset name in the search box.
2. Results are fetched from `/api/connect/asset-registry/assets?search=<query>` (proxied via the `asset-registry` connector).
3. Click a row to insert the chip at the cursor position.

#### Save-side mention sync

Every time a document is saved (`PUT /api/docs/:id`), the server:
1. Walks the ProseMirror JSON tree recursively.
2. Collects all `assetRef` nodes grouped by `assetId`.
3. Deletes mention rows for assets no longer present.
4. Upserts a row in `pm_asset_document_mention` for each asset still referenced, updating `mention_count`, `tag`, `display`, and `last_seen_at`.

This keeps `pm_asset_document_mention` current without any client-side work.

#### Reverse lookup

```
GET /api/asset-mentions?assetId=55799181-...
→ [{ document_id, title, tag, display, mention_count, last_seen_at }, …]

GET /api/asset-mentions?docId=<doc-id>
→ [{ asset_id, tag, display, mention_count, first_seen_at, last_seen_at }, …]
```

#### Relevant files

| File | Purpose |
|------|---------|
| `src/extensions/assetRef/commands.js` | `insertAssetRef(attrs)` ProseMirror command |
| `src/extensions/assetRef/nodeView.js` | `AssetRefNodeView` — chip DOM renderer |
| `src/schema.js` | `assetRefNodeSpec` — inline atom node definition |
| `src/menu.js` | Toolbar button + `openAssetRefPicker()` search modal |
| `src/main.js` | NodeView registration |
| `src/reader.js` | NodeView registration (read-only view) |
| `src/editor.css` | `.asset-ref-chip`, `.arp-*` styles |
| `server.js` | `collectAssetRefs()`, `syncAssetMentions()`, `/api/asset-mentions` |

---

## Connectors

The connector system is a generic authenticated proxy. Any registered connector can be reached at:

```
/api/connect/<name>/<path>
```

The server looks up the connector by name, injects the configured auth header, and forwards the request to `base_url + path_prefix + /<path>`.

### Auth types

| `auth_type` | Behaviour |
|-------------|-----------|
| `api_key` | Adds `auth_header: auth_value` to every request |
| `bearer` | Adds `Authorization: Bearer <auth_value>` |
| `basic` | Adds `Authorization: Basic <auth_value>` |
| `none` | No auth header added |

### Asset Registry connector

The Asset Registry (`http://localhost:5177`) is registered as the `asset-registry` connector with `auth_type: none`. Its API can be reached at:

```
GET /api/connect/asset-registry/assets?search=pump&limit=20
GET /api/connect/asset-registry/assets/<uuid>
```

The connector URL can be updated at runtime via:
```
PUT /api/connectors/asset-registry
{ "base_url": "https://assets.production.example.com" }
```

No server restart required.

---

## Audit log

Every `/api/*` request (excluding `/api/audit-log` itself) is logged to `pm_audit_log` after the response is sent. The log is non-blocking — it never delays the response.

Browse logs at **`/audit.html`** (linked from the docs sidebar footer).

Query parameters for `GET /api/audit-log`:

| Param | Example | Description |
|-------|---------|-------------|
| `method` | `GET` | Filter by HTTP method |
| `path` | `/api/docs` | Substring match on path |
| `status` | `500` | Exact status code |
| `from` | `2026-04-01` | Start date (inclusive) |
| `to` | `2026-04-30` | End date (inclusive) |
| `limit` | `50` | Max rows (capped at 500) |
| `offset` | `100` | Pagination offset |
