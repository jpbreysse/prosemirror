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

All 11 tables live in the `myproject` database under the `public` schema.

| Table | Created by | Purpose |
|---|---|---|
| `pm_documents` | `server.js` on start | Editor documents (ProseMirror JSON) |
| `pm_document_versions` | `server.js` on start | Version snapshots per document |
| `clauses` | LexAPI migration `001_clauses.sql` | Clause library |
| `clause_versions` | LexAPI migration `001_clauses.sql` | Clause change history |
| `matters` | LexAPI migration `002_matters_parties.sql` | Legal matters |
| `parties` | LexAPI migration `002_matters_parties.sql` | Legal parties (companies, individuals) |
| `matter_clauses` | LexAPI migration `002_matters_parties.sql` | Clauses attached to a matter |
| `matter_parties` | LexAPI migration `002_matters_parties.sql` | Parties linked to a matter |
| `customers` | CustomerAPI migration `001_customers.sql` | CRM customers |
| `assets` | CustomerAPI migration `002_assets.sql` | Assets per customer |
| `interactions` | CustomerAPI migration `002_assets.sql` | Customer interactions |

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
