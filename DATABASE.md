# Local Database Setup

All three backend services share a single **PostgreSQL 16** instance running in Docker.

---

## 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- Node.js 18+

---

## 2. Start the Database

The database runs in the `postgres-pgvector` Docker container (PostgreSQL 16 + pgvector extension).

```bash
# Start (or restart) the container
docker start postgres-pgvector

# First time only — create the container
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Check it is running:

```bash
docker ps | grep postgres-pgvector
# Should show: Up ... (healthy)
```

---

## 3. Databases and Users

There are three databases, all inside the same container:

| Database    | Owner / User | Password      | Used by          |
|-------------|-------------|---------------|------------------|
| `myproject` | `myproject` | `yourpassword`| ProseMirror editor, LexAPI, CustomerAPI |
| `lex`       | `postgres`  | `postgres`    | (legacy — not actively used) |
| `crm`       | `postgres`  | `postgres`    | (legacy) |

### Create the `myproject` user and database (first time only)

```bash
docker exec -it postgres-pgvector psql -U postgres
```

Then inside psql:

```sql
CREATE USER myproject WITH PASSWORD 'yourpassword';
CREATE DATABASE myproject OWNER myproject;
GRANT ALL PRIVILEGES ON DATABASE myproject TO myproject;
\q
```

---

## 4. Tables

All tables live in the `myproject` database under the `public` schema.

### ProseMirror tables — created by `server.js` on start

| Table | Purpose |
|---|---|
| `pm_documents` | Editor documents (ProseMirror JSON) |
| `pm_document_versions` | Version snapshots per document |
| `pm_document_link` | Typed directed links between documents (references, supersedes, implements, closes) |
| `pm_collections` | Named folders that group documents |
| `pm_collection_docs` | Many-to-many join between collections and documents |
| `pm_connectors` | Registry of external systems proxied by the API |
| `pm_extension_config` | Workspace-level on/off toggles for editor extensions |
| `pm_audit_log` | Append-only record of every API request |
| `pm_asset_document_mention` | Index of asset references found inside documents |
| `lci_workshops` | Lummus engagement discovery workshops |
| `lci_participants` | Workshop participants |
| `lci_questions` | Discussion questions per workshop |

### LexAPI tables — created by LexAPI migrations

| Table | Migration | Purpose |
|---|---|---|
| `clauses` | `001_clauses.sql` | Clause library |
| `clause_versions` | `001_clauses.sql` | Clause change history |
| `matters` | `002_matters_parties.sql` | Legal matters |
| `parties` | `002_matters_parties.sql` | Legal parties (companies, individuals) |
| `matter_clauses` | `002_matters_parties.sql` | Clauses attached to a matter |
| `matter_parties` | `002_matters_parties.sql` | Parties linked to a matter |

### CustomerAPI tables — created by CustomerAPI migrations

| Table | Migration | Purpose |
|---|---|---|
| `customers` | `001_customers.sql` | CRM customers |
| `assets` | `002_assets.sql` | Assets per customer |
| `interactions` | `002_assets.sql` | Customer interactions |

### How tables are created

- **ProseMirror tables** (`pm_*`): created automatically when `server.js` starts via `initDb()` — uses `CREATE TABLE IF NOT EXISTS`, safe to run repeatedly.
- **LexAPI tables**: created by SQL migration files in `LexAPI/src/db/migrations/` — run automatically when `LexAPI/server.js` starts.
- **CustomerAPI tables**: same pattern, migrations in `CustomerAPI/src/db/migrations/`.

You never need to run migrations manually — starting each service handles it.

---

## 5. Environment Variables

Each service reads `DATABASE_URL` from its `.env` file.

**ProseMirror** (`/dev/ProseMirror/.env`):
```env
DATABASE_URL=postgresql://myproject:yourpassword@localhost:5432/myproject
```

**LexAPI** (`/dev/LexAPI/.env`):
```env
DATABASE_URL=postgresql://myproject:yourpassword@localhost:5432/myproject
API_KEY=lex-api-dev-key
PORT=3003
```

**CustomerAPI** (`/dev/CustomerAPI/.env`):
```env
DATABASE_URL=postgresql://myproject:yourpassword@localhost:5432/myproject
API_KEY=customer-api-dev-key
PORT=3002
```

---

## 6. Connect to the Database (GUI & CLI)

### psql (command line)

```bash
# Via Docker (no local psql needed)
docker exec -it postgres-pgvector psql -U myproject -d myproject

# If psql is installed locally
psql postgresql://myproject:yourpassword@localhost:5432/myproject
```

Useful psql commands:

```sql
\dt                  -- list all tables
\d pm_documents      -- describe a table
SELECT * FROM pm_documents ORDER BY updated_at DESC LIMIT 5;
SELECT * FROM clauses WHERE category = 'dispute';
SELECT * FROM matters WHERE deleted_at IS NULL;
```

### TablePlus / DBeaver / pgAdmin (GUI)

Use these connection settings:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `myproject` |
| User | `myproject` |
| Password | `yourpassword` |

---

## 7. Start All Services

```bash
# 1. Database (Docker)
docker start postgres-pgvector

# 2. ProseMirror editor + API  (port 3001 + Vite on 5173)
cd ~/dev/ProseMirror && node server.js &
cd ~/dev/ProseMirror && npm run dev &

# 3. LexAPI  (port 3003)
cd ~/dev/LexAPI && node server.js &

# 4. CustomerAPI  (port 4002)
cd ~/dev/CustomerAPI && node server.js &
```

Or check what's already running:

```bash
lsof -i:3001 -i:3002 -i:3003 -i:5173 | grep LISTEN
```

---

## 8. Reset / Wipe Data

```bash
# Drop and recreate all tables (destructive!)
docker exec -it postgres-pgvector psql -U myproject -d myproject -c "
  DROP TABLE IF EXISTS pm_document_versions, pm_documents,
    matter_clauses, matter_parties, matters, parties,
    clause_versions, clauses, interactions, assets, customers CASCADE;
"

# Then restart all services — they will recreate the tables automatically
```

---

## 9. Backup

```bash
# Dump the full myproject database
docker exec postgres-pgvector pg_dump -U myproject myproject > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i postgres-pgvector psql -U myproject -d myproject < backup_20260415.sql
```

---

## 10. ProseMirror Schema Reference

All `pm_*` and `lci_*` tables are created by `initDb()` in `server.js` using `CREATE TABLE IF NOT EXISTS` — safe to run on every server start.

### pm_documents

Core document store. Each row is one ProseMirror document.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `TEXT` | — | **PK.** Client-generated document ID (UUID string) |
| `content` | `JSONB` | `'{}'` | Full ProseMirror doc serialised via `doc.toJSON()` |
| `title` | `TEXT` | `''` | Plain-text document title (extracted from first H1 on save) |
| `tags` | `TEXT[]` | `'{}'` | User-assigned tags. Filtered with `= ANY(tags)` |
| `created_at` | `TIMESTAMPTZ` | `now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `now()` | Last save timestamp |

> `content` is full JSONB. Full-text search strips JSON key names with `regexp_replace` before doing an `ILIKE` match.  
> On save, if the incoming `title` is blank the existing value is preserved (`COALESCE(NULLIF(…,''), pm_documents.title)`).

---

### pm_document_versions

Snapshot history created explicitly by the user ("Save version").

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `doc_id` | `TEXT` | — | **FK → pm_documents(id) CASCADE** |
| `version_num` | `INT` | — | Sequential number within the document (1, 2, 3 …) |
| `label` | `TEXT` | `''` | Human label, e.g. `"v3"` or `"Before refactor"` |
| `content` | `JSONB` | — | Snapshot of `pm_documents.content` at save time |
| `created_at` | `TIMESTAMPTZ` | `now()` | When the version was saved |

> `version_num` is computed at insert time as `MAX(version_num) + 1` per document.  
> Deleting the parent document cascades to all its versions.

---

### pm_document_link

Typed directed links between documents.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `from_doc` | `TEXT` | — | **FK → pm_documents(id) CASCADE** |
| `to_doc` | `TEXT` | — | **FK → pm_documents(id) CASCADE** |
| `link_type` | `TEXT` | — | One of: `references` · `supersedes` · `superseded_by` · `implements` · `closes` |
| `from_title` | `TEXT` | `''` | Cached source title at creation time |
| `to_title` | `TEXT` | `''` | Cached target title at creation time |
| `created_at` | `TIMESTAMPTZ` | `now()` | — |

**Constraints:** `from_doc <> to_doc` · `UNIQUE (from_doc, to_doc, link_type)`

| `link_type` | Meaning |
|---|---|
| `references` | Doc cites another as a source |
| `supersedes` | Doc replaces an older one |
| `superseded_by` | Inverse of `supersedes` (auto-created in same transaction) |
| `implements` | Doc describes implementation of a spec |
| `closes` | Doc resolves an issue or request |

> `supersedes` ↔ `superseded_by` are kept in sync automatically: creating or deleting one side handles the other in a single transaction.

**Indexes:** `(from_doc)` · `(to_doc)`

---

### pm_collections

Named folders that group documents.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `name` | `TEXT` | — | Display name, e.g. `"Legal"` |
| `color` | `TEXT` | `'#6366f1'` | Hex colour for the folder icon |
| `created_at` | `TIMESTAMPTZ` | `now()` | — |

---

### pm_collection_docs

Many-to-many join between collections and documents.

| Column | Type | Description |
|---|---|---|
| `collection_id` | `UUID` | **FK → pm_collections(id) CASCADE** |
| `doc_id` | `TEXT` | **FK → pm_documents(id) CASCADE** |
| `added_at` | `TIMESTAMPTZ` | When the document was added |

**PK:** `(collection_id, doc_id)`

---

### pm_connectors

Registry of external systems proxied by the API (`/api/connect/:name/*`).

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `name` | `TEXT` | — | **UNIQUE.** URL slug used in `/api/connect/:name/*` |
| `label` | `TEXT` | `''` | Human-readable display name |
| `base_url` | `TEXT` | — | Root URL of the external system |
| `auth_type` | `TEXT` | `'api_key'` | `api_key` · `bearer` · `basic` · `none` |
| `auth_header` | `TEXT` | `'X-API-Key'` | Header name for `api_key` auth |
| `auth_value` | `TEXT` | `''` | Credential — **encrypt in production**. Omitted from GET responses. |
| `path_prefix` | `TEXT` | `''` | Path segment appended before the forwarded path, e.g. `/api/v1` |
| `enabled` | `BOOLEAN` | `true` | Disabled connectors are excluded from proxy routing |
| `created_at` | `TIMESTAMPTZ` | `now()` | — |

**Pre-seeded rows**

| `name` | `label` | Default `base_url` | Auth |
|---|---|---|---|
| `crm` | CRM | `http://localhost:3002` | `api_key` / `X-API-Key` |
| `lex` | LexAPI | `http://localhost:3003` | `api_key` / `X-API-Key` |
| `asset-registry` | Asset Registry | `http://localhost:5177` | `none` |

---

### pm_extension_config

Workspace-level on/off toggles for editor toolbar extensions.

| Column | Type | Default | Description |
|---|---|---|---|
| `key` | `TEXT` | — | **PK.** Extension identifier, e.g. `"kanban"`, `"riskMatrix"` |
| `enabled` | `BOOLEAN` | `true` | Whether the extension is active |

> Missing rows default to **enabled** — the UI treats absent keys as `true` (opt-in disable model).

---

### pm_audit_log

Append-only record of every `/api/*` request. Written asynchronously after each response; never blocks the caller.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `ts` | `TIMESTAMPTZ` | `now()` | Request timestamp |
| `method` | `TEXT` | — | HTTP method |
| `path` | `TEXT` | — | Request path |
| `status` | `INT` | — | HTTP response status code |
| `duration_ms` | `INT` | — | Response time in milliseconds |
| `ip` | `TEXT` | — | Client IP (first of `X-Forwarded-For`, else socket address) |
| `user_agent` | `TEXT` | — | `User-Agent` header |
| `body_size` | `INT` | `0` | `Content-Length` in bytes |

> `/api/audit-log` itself is excluded from logging to avoid self-logging noise.

**Index:** `(ts DESC)` — supports fast time-range queries.

---

### pm_asset_document_mention

Cross-reference index between documents and assets from the external Asset Registry. Rebuilt on every document save via `syncAssetMentions()`.

| Column | Type | Default | Description |
|---|---|---|---|
| `document_id` | `TEXT` | — | **FK → pm_documents(id) CASCADE** |
| `asset_id` | `TEXT` | — | Asset ID from the external registry (no FK — external system) |
| `tag` | `TEXT` | `''` | Asset tag / serial as it appears in the `assetRef` node |
| `display` | `TEXT` | `''` | Human-readable name cached from the node |
| `mention_count` | `INT` | `1` | Number of `assetRef` nodes pointing to this asset in the doc |
| `first_seen_at` | `TIMESTAMPTZ` | `now()` | First time this asset appeared in this document |
| `last_seen_at` | `TIMESTAMPTZ` | `now()` | Last save that included this reference |

**PK:** `(document_id, asset_id)`  
**Index:** `(asset_id)` — "which documents mention this asset?" reverse lookup.

> On each save: references no longer present are deleted; current ones are upserted with an updated `mention_count`.

---

### lci_workshops

Lummus engagement discovery sessions.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `TEXT` | — | **PK.** `W1`–`W4` |
| `title` | `TEXT` | — | Workshop title |
| `week` | `INT` | — | Delivery week number |
| `duration` | `INT` | `120` | Session length in minutes |
| `objective` | `TEXT` | — | Session objective description |
| `ext_effort` | `INT` | `8` | External consultant hours |
| `lci_effort` | `TEXT` | — | Lummus internal effort, formatted e.g. `"4h30"` |
| `status` | `TEXT` | `'upcoming'` | `upcoming` · `complete` · (custom) |

---

### lci_participants

People involved in the engagement.

| Column | Type | Description |
|---|---|---|
| `id` | `UUID` | **PK** `gen_random_uuid()` |
| `name` | `TEXT` | Full name or role label |
| `role` | `TEXT` | Job title or role description |
| `type` | `TEXT` | `external` (consultant) or `lummus` (client staff) |
| `workshops` | `TEXT[]` | Workshop IDs attended, e.g. `{W1,W2,W4}` |
| `total_effort` | `TEXT` | Total time commitment, e.g. `"10h"` |
| `commitment_detail` | `TEXT` | Free-text breakdown of effort distribution |

---

### lci_questions

Discussion questions assigned to workshops.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | **PK** |
| `workshop_id` | `TEXT` | — | **FK → lci_workshops(id) CASCADE** |
| `number` | `INT` | — | Question number within the workshop |
| `text` | `TEXT` | — | The question text |
| `block` | `TEXT` | `NULL` | Optional section heading, e.g. `"Activities"`, `"Gaps"` |
| `sort_order` | `INT` | `0` | Display order (increments of 10) |

**Constraint:** `UNIQUE (workshop_id, number)`

---

### Index Summary

| Index | Table | Column(s) | Use |
|---|---|---|---|
| `pm_audit_log_ts_idx` | `pm_audit_log` | `ts DESC` | Time-range queries on the audit log |
| `pm_asset_mention_asset_idx` | `pm_asset_document_mention` | `asset_id` | Reverse lookup — documents per asset |
| `pm_document_link_from_idx` | `pm_document_link` | `from_doc` | Outgoing links from a document |
| `pm_document_link_to_idx` | `pm_document_link` | `to_doc` | Incoming links to a document |

---

### Entity Relationship Diagram

```mermaid
erDiagram

    pm_documents {
        TEXT        id          PK
        JSONB       content
        TEXT        title
        TEXT[]      tags
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    pm_document_versions {
        UUID        id          PK
        TEXT        doc_id      FK
        INT         version_num
        TEXT        label
        JSONB       content
        TIMESTAMPTZ created_at
    }

    pm_document_link {
        UUID        id          PK
        TEXT        from_doc    FK
        TEXT        to_doc      FK
        TEXT        link_type
        TEXT        from_title
        TEXT        to_title
        TIMESTAMPTZ created_at
    }

    pm_collections {
        UUID        id          PK
        TEXT        name
        TEXT        color
        TIMESTAMPTZ created_at
    }

    pm_collection_docs {
        UUID        collection_id   FK
        TEXT        doc_id          FK
        TIMESTAMPTZ added_at
    }

    pm_asset_document_mention {
        TEXT        document_id     FK
        TEXT        asset_id
        TEXT        tag
        TEXT        display
        INT         mention_count
        TIMESTAMPTZ first_seen_at
        TIMESTAMPTZ last_seen_at
    }

    pm_connectors {
        UUID        id          PK
        TEXT        name
        TEXT        label
        TEXT        base_url
        TEXT        auth_type
        TEXT        auth_header
        TEXT        auth_value
        TEXT        path_prefix
        BOOLEAN     enabled
        TIMESTAMPTZ created_at
    }

    pm_extension_config {
        TEXT        key         PK
        BOOLEAN     enabled
    }

    pm_audit_log {
        UUID        id          PK
        TIMESTAMPTZ ts
        TEXT        method
        TEXT        path
        INT         status
        INT         duration_ms
        TEXT        ip
        TEXT        user_agent
        INT         body_size
    }

    lci_workshops {
        TEXT        id          PK
        TEXT        title
        INT         week
        INT         duration
        TEXT        objective
        INT         ext_effort
        TEXT        lci_effort
        TEXT        status
    }

    lci_participants {
        UUID        id                  PK
        TEXT        name
        TEXT        role
        TEXT        type
        TEXT[]      workshops
        TEXT        total_effort
        TEXT        commitment_detail
    }

    lci_questions {
        UUID        id          PK
        TEXT        workshop_id FK
        INT         number
        TEXT        text
        TEXT        block
        INT         sort_order
    }

    %% ── Relationships ──────────────────────────────────────────────────────────

    pm_documents            ||--o{ pm_document_versions      : "versioned by"
    pm_documents            ||--o{ pm_document_link          : "links from"
    pm_documents            ||--o{ pm_document_link          : "linked to"
    pm_documents            ||--o{ pm_collection_docs        : "grouped in"
    pm_documents            ||--o{ pm_asset_document_mention : "mentions"
    pm_collections          ||--o{ pm_collection_docs        : "contains"
    lci_workshops           ||--o{ lci_questions             : "has"
```

> `pm_connectors`, `pm_extension_config`, `pm_audit_log`, and `lci_participants` have no FK dependencies — they are standalone tables.
