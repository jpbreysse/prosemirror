/**
 * server.js
 *
 * Minimal Express API that persists ProseMirror documents in PostgreSQL.
 * Runs on port 3001; Vite proxies /api → this server.
 *
 * Table: pm_documents
 *   id         TEXT PRIMARY KEY
 *   content    JSONB          – doc.toJSON()
 *   title      TEXT
 *   created_at TIMESTAMPTZ
 *   updated_at TIMESTAMPTZ
 */

const express = require("express");
const { Pool } = require("pg");
const cors    = require("cors");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");

// ── File uploads ──────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg","image/png","image/gif","image/webp","image/svg+xml","image/avif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Database ──────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://myproject:yourpassword@localhost:5432/myproject",
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_documents (
      id         TEXT        PRIMARY KEY,
      content    JSONB       NOT NULL DEFAULT '{}',
      title      TEXT        NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_document_versions (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id      TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
      version_num INT         NOT NULL,
      label       TEXT        NOT NULL DEFAULT '',
      content     JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Migration: tags column
  await pool.query(`ALTER TABLE pm_documents ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'`);
  // Collections
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_collections (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT        NOT NULL,
      color      TEXT        NOT NULL DEFAULT '#6366f1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_collection_docs (
      collection_id UUID NOT NULL REFERENCES pm_collections(id) ON DELETE CASCADE,
      doc_id        TEXT NOT NULL REFERENCES pm_documents(id)   ON DELETE CASCADE,
      added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, doc_id)
    )
  `);
  // Connector registry — one row per external system
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_connectors (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT        NOT NULL UNIQUE,   -- slug used in URL: /api/connect/:name/*
      label       TEXT        NOT NULL DEFAULT '',
      base_url    TEXT        NOT NULL,
      auth_type   TEXT        NOT NULL DEFAULT 'api_key', -- 'api_key' | 'bearer' | 'basic' | 'none'
      auth_header TEXT        NOT NULL DEFAULT 'X-API-Key',
      auth_value  TEXT        NOT NULL DEFAULT '',        -- store encrypted in production
      path_prefix TEXT        NOT NULL DEFAULT '',        -- e.g. '/api/v1'
      enabled     BOOLEAN     NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Seed built-in connectors if not already present
  await pool.query(`
    INSERT INTO pm_connectors (name, label, base_url, auth_type, auth_header, auth_value, path_prefix)
    VALUES
      ('crm',            'CRM',            $1, 'api_key', 'X-API-Key', $2, '/api'),
      ('lex',            'LexAPI',         $3, 'api_key', 'X-API-Key', $4, '/api'),
      ('asset-registry', 'Asset Registry', $5, 'none',    '',          '',  '/api')
    ON CONFLICT (name) DO NOTHING
  `, [
    process.env.CRM_BASE_URL            || 'http://localhost:3002',
    process.env.CRM_API_KEY             || 'customer-api-dev-key',
    process.env.LEX_BASE_URL            || 'http://localhost:3003',
    process.env.LEX_API_KEY             || 'lex-api-dev-key',
    process.env.ASSET_REGISTRY_BASE_URL || 'http://localhost:5177',
  ]);
  // Extension toggle config — one row per extension key, default enabled
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_extension_config (
      key     TEXT    PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT true
    )
  `);

  // Audit log — append-only record of every API request
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_audit_log (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
      method      TEXT        NOT NULL,
      path        TEXT        NOT NULL,
      status      INT,
      duration_ms INT,
      ip          TEXT,
      user_agent  TEXT,
      body_size   INT         DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS pm_audit_log_ts_idx ON pm_audit_log (ts DESC)
  `);

  // Asset-document mention index
  // Tracks which assets are referenced in which documents (kept current on every save).
  // asset_id is TEXT with no FK — assets live in the external Asset Registry.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_asset_document_mention (
      document_id   TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
      asset_id      TEXT        NOT NULL,
      tag           TEXT        NOT NULL DEFAULT '',
      display       TEXT        NOT NULL DEFAULT '',
      mention_count INT         NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (document_id, asset_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS pm_asset_mention_asset_idx
      ON pm_asset_document_mention (asset_id)
  `);

  // Document-to-document typed links
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_document_link (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      from_doc   TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
      to_doc     TEXT        NOT NULL REFERENCES pm_documents(id) ON DELETE CASCADE,
      link_type  TEXT        NOT NULL
                 CHECK (link_type IN ('references','supersedes','superseded_by',
                                      'implements','closes')),
      from_title TEXT        NOT NULL DEFAULT '',
      to_title   TEXT        NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT pm_document_link_no_self   CHECK (from_doc <> to_doc),
      CONSTRAINT pm_document_link_unique    UNIQUE (from_doc, to_doc, link_type)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS pm_document_link_from_idx ON pm_document_link (from_doc)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS pm_document_link_to_idx   ON pm_document_link (to_doc)
  `);

  // ── Lummus Phase 2 — Engagement tables ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lci_workshops (
      id          TEXT PRIMARY KEY,           -- W1 … W4
      title       TEXT NOT NULL,
      week        INT  NOT NULL,
      duration    INT  NOT NULL DEFAULT 120,  -- minutes
      objective   TEXT NOT NULL,
      ext_effort  INT  NOT NULL DEFAULT 8,    -- consultant hours
      lci_effort  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'upcoming'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lci_participants (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name             TEXT NOT NULL,
      role             TEXT NOT NULL,
      type             TEXT NOT NULL,          -- 'external' | 'lummus'
      workshops        TEXT[] NOT NULL,        -- e.g. '{W1,W2,W3,W4}'
      total_effort     TEXT NOT NULL,
      commitment_detail TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lci_questions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workshop_id TEXT NOT NULL REFERENCES lci_workshops(id) ON DELETE CASCADE,
      number      INT  NOT NULL,
      text        TEXT NOT NULL,
      block       TEXT,
      sort_order  INT  NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE lci_questions ADD CONSTRAINT lci_questions_workshop_id_number_key UNIQUE (workshop_id, number);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$
  `);

  // Seed workshops
  await pool.query(`
    INSERT INTO lci_workshops (id, title, week, duration, objective, ext_effort, lci_effort)
    VALUES
      ('W1','Consultant Workflow & Knowledge Pain Points',1,120,
       'Map how consultants actually work day-to-day: where time is wasted, where knowledge is lost, and which tasks they wish they could delegate. No preparation required from participants.',
       8,'6h30'),
      ('W2','IT Landscape & Systems Baseline',2,120,
       'Validate IT hypotheses, map the current solution landscape, identify integration constraints, and understand what the IT team can realistically support. Feeds directly into Phase 3 architecture.',
       8,'4h30'),
      ('W3','Invoice Process, Finance & External Integrations',3,120,
       'Map the end-to-end invoice lifecycle from engagement sign-off to payment collection, identify pain points in the current finance workflow, and evaluate integration opportunities with external accounting and ERP solutions.',
       8,'4h30'),
      ('W4','Core Business Activities & Strategic Objectives',4,120,
       'Produce a comprehensive inventory of Lummus''s core business activities and the strategic objectives behind each one — from business development and client delivery to internal operations and knowledge management.',
       8,'4h30')
    ON CONFLICT (id) DO NOTHING
  `);

  // Seed participants
  await pool.query(`
    INSERT INTO lci_participants (name, role, type, workshops, total_effort, commitment_detail)
    VALUES
      ('External Programme Lead','External Programme Lead','external','{W1,W2,W3,W4}','40h',
       'W1 prep + session + synthesis (8h) · W2 prep + session + synthesis (8h) · W3 prep + session + synthesis (8h) · W4 prep + session + synthesis (8h) · deliverables writing (8h)'),
      ('Designated Project Lead','Designated Project Lead (DPL)','lummus','{W1,W2,W3,W4}','10h',
       '4 full sessions (4 × 2h) · 4 post-session debriefs (4 × 30min) · async follow-up between sessions'),
      ('Project Sponsor','Project Sponsor','lummus','{W4}','2h',
       'W4 full session (2h)'),
      ('Senior Consultant A','Senior Consultant','lummus','{W1}','2h',
       'W1 full session (2h)'),
      ('Senior Consultant B','Senior Consultant','lummus','{W1}','2h',
       'W1 full session (2h)'),
      ('Finance / Operations Lead','Finance / Operations Lead','lummus','{W3}','2h',
       'W3 full session (2h)'),
      ('IT Lead','IT Lead','lummus','{W2}','2h',
       'W2 full session (2h)')
    ON CONFLICT DO NOTHING
  `);

  // Seed questions — W1
  await pool.query(`
    INSERT INTO lci_questions (workshop_id, number, text, sort_order) VALUES
      ('W1',1,'Walk me through a typical engagement from kickoff to final report. Where do you personally spend the most time?',10),
      ('W1',2,'How do you start a new engagement — what do you do in the first week?',20),
      ('W1',3,'How much of a typical engagement report is genuinely new versus adapted from previous work?',30),
      ('W1',4,'Where do you store your working notes, interim findings, and draft analyses?',40),
      ('W1',5,'What happens to engagement knowledge when a project closes?',50),
      ('W1',6,'Have you ever wished you could search across all past engagement reports at once?',60),
      ('W1',7,'Which tasks feel like they shouldn''t require a senior consultant?',70),
      ('W1',8,'How do you currently manage client questions and data requests during an engagement?',80),
      ('W1',9,'If you had an AI assistant for one task only, what would you give it?',90)
    ON CONFLICT DO NOTHING
  `);

  // Seed questions — W2
  await pool.query(`
    INSERT INTO lci_questions (workshop_id, number, text, sort_order) VALUES
      ('W2',1,'Walk me through your current technology stack — what are the main systems and what does each one do?',10),
      ('W2',2,'How is Microsoft 365 actually used — specifically SharePoint and Teams?',20),
      ('W2',3,'How is your IT team structured — how many people, what are the roles, and who is responsible for what?',30),
      ('W2',4,'Do you have dedicated IT support staff, or is IT managed alongside other responsibilities?',40),
      ('W2',5,'Who owns the relationship between IT and the rest of the business — is there a business analyst or project manager role?',50),
      ('W2',6,'What project management tools are currently in use?',60),
      ('W2',7,'Where is data hosted today — on-premise, cloud, or hybrid?',70),
      ('W2',8,'What is your current security and compliance posture — ISO 27001, Cyber Essentials, SOC 2?',80),
      ('W2',9,'What are the biggest IT pain points you personally deal with today?',90),
      ('W2',10,'What is your approach to disaster recovery and business continuity — and are there active vendor contracts or licence renewals coming up in the next 12 months?',100)
    ON CONFLICT (workshop_id, number) DO NOTHING
  `);

  // Seed questions — W3
  await pool.query(`
    INSERT INTO lci_questions (workshop_id, number, text, sort_order) VALUES
      ('W3',1,'Walk me through the invoice lifecycle: from the moment an engagement is signed off to the point payment is received.',10),
      ('W3',2,'Who is responsible for creating, approving, and sending invoices today, and what tools do they use?',20),
      ('W3',3,'How do you handle milestone-based or phased billing — is it manual or linked to project milestones?',30),
      ('W3',4,'What accounting or finance systems are currently in use (e.g., Xero, QuickBooks, Sage), and how well do they integrate with your other tools?',40),
      ('W3',5,'Where do invoices and payment records live today — and can you easily reconcile them against engagement data?',50),
      ('W3',6,'What are the biggest pain points in your current invoicing process (e.g., late payments, manual data entry, reconciliation errors)?',60),
      ('W3',7,'Have you evaluated any integrations between your PM/CRM tools and your accounting system to automate invoice generation?',70),
      ('W3',8,'If you could automate one part of the finance or invoicing workflow tomorrow, what would have the biggest impact?',80),
      ('W3',9,'Are there multi-currency, cross-border, or VAT considerations in your invoicing — and how is audit trail compliance managed today?',90)
    ON CONFLICT (workshop_id, number) DO NOTHING
  `);

  // Seed questions — W4 (three blocks)
  await pool.query(`
    INSERT INTO lci_questions (workshop_id, number, text, block, sort_order) VALUES
      ('W4',1,'List every major business activity at Lummus today — from winning new work through to closing an engagement. What are the big categories?','Activities',10),
      ('W4',2,'For each activity, who owns it and how much of the team''s time does it consume in a typical month?','Activities',20),
      ('W4',3,'Are there activities that happen informally or ad hoc that aren''t captured in any process today?','Activities',30),
      ('W4',4,'For each business activity, what is the primary objective? What does "success" look like?','Objectives',40),
      ('W4',5,'How do you measure whether each activity is meeting its objective today? Are there KPIs or is it intuition-based?','Objectives',50),
      ('W4',6,'Which objectives are you confidently hitting, and which ones feel like they''re falling short?','Objectives',60),
      ('W4',7,'Where are the biggest gaps between what an activity is supposed to achieve and what actually happens?','Gaps',70),
      ('W4',8,'Are there business activities you know you should be doing but aren''t yet — things on the roadmap or wish list?','Gaps',80),
      ('W4',9,'If you had to rank these activities by strategic importance to Lummus over the next 12 months, what comes out on top?','Gaps',90)
    ON CONFLICT (workshop_id, number) DO NOTHING
  `);

  console.log("✓ Database ready");
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── Static serving (production) ───────────────────────────────────────────────
// In production (after `npm run build`), serve the Vite dist/ folder.
// In dev, Vite's own server handles this on port 5173.
if (process.env.NODE_ENV === "production") {
  const DIST = path.join(__dirname, "dist");
  app.use(express.static(DIST));
  // SPA fallback — any unmatched GET returns index.html
  app.get(/^(?!\/api\/).*/, (_req, res) =>
    res.sendFile(path.join(DIST, "index.html"))
  );
}

// Serve uploaded files as static assets
app.use("/uploads", express.static(UPLOADS_DIR));

// ── Audit-log middleware ──────────────────────────────────────────────────────
// Fires after every /api/* response (non-blocking fire-and-forget insert).
// Skips /api/audit-log itself to avoid self-logging noise.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") || req.path.startsWith("/api/audit-log")) {
    return next();
  }
  const t0       = Date.now();
  const ip       = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const bodySize = parseInt(req.headers["content-length"] || "0", 10) || 0;

  res.on("finish", () => {
    pool.query(
      `INSERT INTO pm_audit_log (method, path, status, duration_ms, ip, user_agent, body_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.method, req.path, res.statusCode, Date.now() - t0, ip,
       req.headers["user-agent"] || "", bodySize]
    ).catch(() => {}); // never block the response
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Upload an image
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No valid image file received" });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// List all documents with version count and word count
// GET /api/docs
//   ?search=<text>      — ILIKE filter on title; also searches tag values and plain
//                          text extracted from content JSON
//   ?tag=<value>        — documents whose tags array contains this value (exact)
//   ?collection=<uuid>  — documents belonging to this collection
//   ?limit=<n>          — default 200, max 1000
//   ?offset=<n>         — default 0
app.get("/api/docs", async (req, res) => {
  try {
    const search     = (req.query.search     || "").trim();
    const tag        = (req.query.tag        || "").trim();
    const collection = (req.query.collection || "").trim();
    const limit      = Math.min(parseInt(req.query.limit  || "200", 10), 1000);
    const offset     = Math.max(parseInt(req.query.offset || "0",   10), 0);

    const conds  = [];
    const params = [];
    let   i      = 1;

    if (search) {
      // Match title, any tag value, or raw text extracted from the content JSON.
      // The content cast strips JSON noise well enough for basic keyword search.
      conds.push(`(
        d.title ILIKE $${i}
        OR EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE t ILIKE $${i})
        OR regexp_replace(
             regexp_replace(d.content::text, '"type"\\s*:\\s*"[^"]*"', '', 'g'),
             '[^a-zA-ZÀ-ÿ0-9\\s]', ' ', 'g'
           ) ILIKE $${i}
      )`);
      params.push(`%${search}%`);
      i++;
    }

    if (tag) {
      conds.push(`$${i} = ANY(d.tags)`);
      params.push(tag);
      i++;
    }

    if (collection) {
      conds.push(`EXISTS (
        SELECT 1 FROM pm_collection_docs cd
        WHERE cd.doc_id = d.id AND cd.collection_id = $${i}::uuid
      )`);
      params.push(collection);
      i++;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    params.push(limit, offset);

    const { rows } = await pool.query(`
      SELECT
        d.id,
        d.title,
        d.created_at,
        d.updated_at,
        d.tags,
        COALESCE(v.version_count, 0)::int AS version_count,
        array_length(
          regexp_split_to_array(
            trim(regexp_replace(
              regexp_replace(d.content::text, '"type"\\s*:\\s*"[^"]*"', '', 'g'),
              '[^a-zA-ZÀ-ÿ0-9\\s]', ' ', 'g'
            )),
            '\\s+'
          ), 1
        ) AS word_count,
        COALESCE(c.collection_ids, '{}') AS collection_ids
      FROM pm_documents d
      LEFT JOIN (
        SELECT doc_id, COUNT(*)::int AS version_count
        FROM pm_document_versions
        GROUP BY doc_id
      ) v ON v.doc_id = d.id
      LEFT JOIN (
        SELECT doc_id, ARRAY_AGG(collection_id::text) AS collection_ids
        FROM pm_collection_docs
        GROUP BY doc_id
      ) c ON c.doc_id = d.id
      ${where}
      ORDER BY d.updated_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, params);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Stats — must be before /:id to avoid being swallowed by that route
app.get("/api/docs/stats", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                                          AS total_docs,
        COUNT(*) FILTER (WHERE updated_at > now() - interval '7 days')::int AS active_this_week,
        COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS created_this_month,
        COALESCE(SUM(octet_length(content::text)), 0)::bigint AS total_bytes,
        (SELECT COUNT(*)::int FROM pm_document_versions)      AS total_versions
      FROM pm_documents
    `);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get one document
app.get("/api/docs/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pm_documents WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new document (ignores conflict — idempotent)
app.post("/api/docs", async (req, res) => {
  const { id, content, title } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO pm_documents (id, content, title)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [id, JSON.stringify(content), title || ""]
    );
    res.status(201).json(rows[0] || { id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Asset-mention helpers ─────────────────────────────────────────────────────

/**
 * Walk a ProseMirror doc JSON tree and collect all assetRef nodes.
 * Returns a Map<assetId, { tag, display, count }>.
 */
function collectAssetRefs(nodes, acc = new Map()) {
  for (const n of nodes || []) {
    if (n.type === "assetRef" && n.attrs?.assetId) {
      const { assetId, tag = "", display = "" } = n.attrs;
      const cur = acc.get(assetId) || { tag, display, count: 0 };
      cur.count++;
      acc.set(assetId, cur);
    }
    if (n.content) collectAssetRefs(n.content, acc);
  }
  return acc;
}

/**
 * Sync pm_asset_document_mention for a given document.
 * Deletes mentions that are no longer present and upserts current ones.
 */
async function syncAssetMentions(docId, content) {
  const refs     = collectAssetRefs(content?.content);
  const assetIds = [...refs.keys()];

  // Remove mentions for assets no longer referenced in the doc
  await pool.query(
    `DELETE FROM pm_asset_document_mention
     WHERE document_id = $1
       AND NOT (asset_id = ANY($2::text[]))`,
    [docId, assetIds]
  );

  // Upsert each current mention
  for (const [assetId, { tag, display, count }] of refs) {
    await pool.query(
      `INSERT INTO pm_asset_document_mention
         (document_id, asset_id, tag, display, mention_count, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,now(),now())
       ON CONFLICT (document_id, asset_id) DO UPDATE SET
         mention_count = EXCLUDED.mention_count,
         tag           = EXCLUDED.tag,
         display       = EXCLUDED.display,
         last_seen_at  = now()`,
      [docId, assetId, tag, display, count]
    );
  }
}

// Upsert (save) a document
app.put("/api/docs/:id", async (req, res) => {
  const { content, title } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO pm_documents (id, content, title)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE
         SET content    = EXCLUDED.content,
             title      = COALESCE(NULLIF(EXCLUDED.title, ''), pm_documents.title),
             updated_at = now()
       RETURNING *`,
      [req.params.id, JSON.stringify(content), title || ""]
    );

    // Keep asset mention index current (fire-and-forget, doesn't block the response)
    syncAssetMentions(req.params.id, content).catch(e =>
      console.error("[assetMentions] sync failed:", e.message)
    );

    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a document
app.delete("/api/docs/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM pm_documents WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Document versions ─────────────────────────────────────────────────────────

// List all versions for a document
app.get("/api/docs/:id/versions", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, doc_id, version_num, label, created_at
       FROM pm_document_versions
       WHERE doc_id = $1
       ORDER BY version_num DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a specific version's content
app.get("/api/docs/:id/versions/:versionId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pm_document_versions WHERE id = $1 AND doc_id = $2`,
      [req.params.versionId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Version not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save a new version
app.post("/api/docs/:id/versions", async (req, res) => {
  const { label } = req.body;
  try {
    // Get next version number
    const { rows: countRows } = await pool.query(
      `SELECT COALESCE(MAX(version_num), 0) + 1 AS next
       FROM pm_document_versions WHERE doc_id = $1`,
      [req.params.id]
    );
    const versionNum = countRows[0].next;
    // Snapshot current document content
    const { rows: docRows } = await pool.query(
      `SELECT content, title FROM pm_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!docRows.length) return res.status(404).json({ error: "Document not found" });
    const { rows } = await pool.query(
      `INSERT INTO pm_document_versions (doc_id, version_num, label, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, versionNum, label || `v${versionNum}`, JSON.stringify(docRows[0].content)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a version
app.delete("/api/docs/:id/versions/:versionId", async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM pm_document_versions WHERE id = $1 AND doc_id = $2`,
      [req.params.versionId, req.params.id]
    );
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Document links ────────────────────────────────────────────────────────────

const VALID_LINK_TYPES = new Set(['references','supersedes','superseded_by','implements','closes']);
const INVERSE_LINK = { supersedes: 'superseded_by', superseded_by: 'supersedes' };

// GET /api/docs/:id/graph?depth=N
// Returns all documents reachable within N hops (both directions) plus all
// edges between them, using WITH RECURSIVE on pm_document_link.
// Response: { center, nodes: [{id,title,depth,updated_at}], edges: [{id,source,target,type}] }
app.get("/api/docs/:id/graph", async (req, res) => {
  const startId = req.params.id;
  const depth   = Math.min(Math.max(parseInt(req.query.depth || "3", 10), 1), 8);

  try {
    // Step 1 — find all reachable node IDs within `depth` hops (undirected BFS)
    const { rows: reachableRows } = await pool.query(`
      WITH RECURSIVE reachable(node_id, depth, visited) AS (
        -- Seed: the starting document
        SELECT $1::text, 0, ARRAY[$1::text]

        UNION ALL

        -- Follow edges in both directions, avoid already-visited nodes
        SELECT
          CASE WHEN l.from_doc = r.node_id THEN l.to_doc ELSE l.from_doc END,
          r.depth + 1,
          r.visited || CASE WHEN l.from_doc = r.node_id THEN l.to_doc ELSE l.from_doc END
        FROM pm_document_link l
        JOIN reachable r ON (l.from_doc = r.node_id OR l.to_doc = r.node_id)
        WHERE r.depth < $2
          AND NOT (
            CASE WHEN l.from_doc = r.node_id THEN l.to_doc ELSE l.from_doc END
            = ANY(r.visited)
          )
      )
      SELECT node_id, MIN(depth) AS min_depth
      FROM reachable
      GROUP BY node_id
    `, [startId, depth]);

    const nodeIds  = reachableRows.map(r => r.node_id);
    const depthMap = Object.fromEntries(reachableRows.map(r => [r.node_id, parseInt(r.min_depth, 10)]));

    // Step 2 — fetch document metadata for all reachable nodes
    const { rows: docRows } = await pool.query(
      `SELECT id, title, updated_at FROM pm_documents WHERE id = ANY($1)`,
      [nodeIds]
    );

    // Step 3 — fetch all edges whose both endpoints are in the reachable set
    const { rows: edgeRows } = await pool.query(
      `SELECT id, from_doc, to_doc, link_type
       FROM pm_document_link
       WHERE from_doc = ANY($1) AND to_doc = ANY($1)`,
      [nodeIds]
    );

    res.json({
      center: startId,
      nodes: docRows.map(d => ({
        id:         d.id,
        title:      d.title || "Untitled",
        depth:      depthMap[d.id] ?? 0,
        updated_at: d.updated_at,
      })),
      edges: edgeRows.map(e => ({
        id:     e.id,
        source: e.from_doc,
        target: e.to_doc,
        type:   e.link_type,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docs/:id/links  →  { outgoing: [...], incoming: [...] }
app.get("/api/docs/:id/links", async (req, res) => {
  try {
    const id = req.params.id;
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/docs/:id/links  body: { to_doc, link_type, from_title, to_title }
app.post("/api/docs/:id/links", async (req, res) => {
  const fromDoc = req.params.id;
  const { to_doc, link_type, from_title = '', to_title = '' } = req.body;

  if (!to_doc)                         return res.status(400).json({ error: 'to_doc is required' });
  if (to_doc === fromDoc)              return res.status(400).json({ error: 'Cannot link a document to itself' });
  if (!VALID_LINK_TYPES.has(link_type)) return res.status(400).json({ error: `Invalid link_type: ${link_type}` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO pm_document_link (from_doc, to_doc, link_type, from_title, to_title)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_doc, to_doc, link_type) DO UPDATE
         SET from_title = EXCLUDED.from_title,
             to_title   = EXCLUDED.to_title
       RETURNING *`,
      [fromDoc, to_doc, link_type, from_title, to_title]
    );

    // Auto-create inverse for supersedes ↔ superseded_by
    const inv = INVERSE_LINK[link_type];
    if (inv) {
      await client.query(
        `INSERT INTO pm_document_link (from_doc, to_doc, link_type, from_title, to_title)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (from_doc, to_doc, link_type) DO NOTHING`,
        [to_doc, fromDoc, inv, to_title, from_title]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23503') return res.status(404).json({ error: 'One or both documents not found' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /api/docs/:id/links/:linkId
app.delete("/api/docs/:id/links/:linkId", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the link — must belong to this doc (either side)
    const { rows } = await client.query(
      `SELECT * FROM pm_document_link WHERE id = $1 AND (from_doc = $2 OR to_doc = $2)`,
      [req.params.linkId, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = rows[0];
    await client.query(`DELETE FROM pm_document_link WHERE id = $1`, [link.id]);

    // Remove inverse if applicable
    const inv = INVERSE_LINK[link.link_type];
    if (inv) {
      await client.query(
        `DELETE FROM pm_document_link
         WHERE from_doc = $1 AND to_doc = $2 AND link_type = $3`,
        [link.to_doc, link.from_doc, inv]
      );
    }

    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Tags ──────────────────────────────────────────────────────────────────────

app.put("/api/docs/:id/tags", async (req, res) => {
  const { tags } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pm_documents SET tags = $1 WHERE id = $2 RETURNING id, tags`,
      [tags || [], req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Collections ───────────────────────────────────────────────────────────────

app.get("/api/collections", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.color, c.created_at,
             COUNT(cd.doc_id)::int AS doc_count
      FROM pm_collections c
      LEFT JOIN pm_collection_docs cd ON cd.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/collections", async (req, res) => {
  const { name, color } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO pm_collections (name, color) VALUES ($1, $2) RETURNING *`,
      [name, color || "#6366f1"]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/collections/:id", async (req, res) => {
  const { name, color } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pm_collections SET
         name  = COALESCE($1, name),
         color = COALESCE($2, color)
       WHERE id = $3 RETURNING *`,
      [name || null, color || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/collections/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM pm_collections WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add docs to a collection
app.post("/api/collections/:id/docs", async (req, res) => {
  const { doc_ids } = req.body;
  if (!Array.isArray(doc_ids) || !doc_ids.length)
    return res.status(400).json({ error: "doc_ids array required" });
  try {
    const placeholders = doc_ids.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(
      `INSERT INTO pm_collection_docs (collection_id, doc_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      [req.params.id, ...doc_ids]
    );
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove a doc from a collection
app.delete("/api/collections/:id/docs/:docId", async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM pm_collection_docs WHERE collection_id = $1 AND doc_id = $2`,
      [req.params.id, req.params.docId]
    );
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Extension Config ──────────────────────────────────────────────────────────
//
// Workspace-level toggles for toolbar buttons.
// Missing rows default to enabled (opt-in disable model).
//
// GET  /api/extensions/config          → { key: boolean, … }
// PUT  /api/extensions/config          → body { key: boolean, … }  (bulk upsert)

app.get("/api/extensions/config", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, enabled FROM pm_extension_config");
    const config = {};
    rows.forEach(r => { config[r.key] = r.enabled; });
    res.json(config);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/extensions/config", async (req, res) => {
  try {
    const entries = Object.entries(req.body || {});
    for (const [key, enabled] of entries) {
      await pool.query(`
        INSERT INTO pm_extension_config (key, enabled)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled
      `, [key, Boolean(enabled)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lummus Engagement API ─────────────────────────────────────────────────────

// GET workshops (with question count)
app.get("/api/engagement/workshops", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, COUNT(q.id)::int AS question_count
       FROM lci_workshops w
       LEFT JOIN lci_questions q ON q.workshop_id = w.id
       GROUP BY w.id ORDER BY w.week`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT workshop — update title, objective, status
app.put("/api/engagement/workshops/:id", async (req, res) => {
  const { title, objective, status } = req.body;
  try {
    await pool.query(
      `UPDATE lci_workshops SET
         title     = COALESCE($1, title),
         objective = COALESCE($2, objective),
         status    = COALESCE($3, status)
       WHERE id = $4`,
      [title || null, objective || null, status || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET participants
app.get("/api/engagement/participants", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM lci_participants
       ORDER BY CASE type WHEN 'external' THEN 0 ELSE 1 END,
                array_length(workshops, 1) DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST participant — add new
app.post("/api/engagement/participants", async (req, res) => {
  const { name, role, type = "lummus", workshops = [], total_effort = "", commitment_detail = "" } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO lci_participants (name, role, type, workshops, total_effort, commitment_detail)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), role || name.trim(), type, workshops, total_effort, commitment_detail]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT participant — update any fields
app.put("/api/engagement/participants/:id", async (req, res) => {
  const { name, role, type, workshops, total_effort, commitment_detail } = req.body;
  try {
    await pool.query(
      `UPDATE lci_participants SET
         name              = COALESCE($1, name),
         role              = COALESCE($2, role),
         type              = COALESCE($3, type),
         workshops         = COALESCE($4, workshops),
         total_effort      = COALESCE($5, total_effort),
         commitment_detail = COALESCE($6, commitment_detail)
       WHERE id = $7`,
      [name||null, role||null, type||null,
       workshops||null, total_effort||null, commitment_detail||null,
       req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE participant
app.delete("/api/engagement/participants/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM lci_participants WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET questions
app.get("/api/engagement/questions", async (req, res) => {
  try {
    const ws = req.query.workshop;
    const { rows } = ws
      ? await pool.query(`SELECT * FROM lci_questions WHERE workshop_id=$1 ORDER BY sort_order`, [ws])
      : await pool.query(`SELECT * FROM lci_questions ORDER BY workshop_id, sort_order`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST question — add to a workshop
app.post("/api/engagement/questions", async (req, res) => {
  const { workshop_id, text, block } = req.body;
  if (!workshop_id || !text?.trim()) return res.status(400).json({ error: "workshop_id and text required" });
  try {
    const { rows: max } = await pool.query(
      `SELECT COALESCE(MAX(sort_order),0)+10 AS next, COALESCE(MAX(number),0)+1 AS num
       FROM lci_questions WHERE workshop_id=$1`, [workshop_id]
    );
    const { rows } = await pool.query(
      `INSERT INTO lci_questions (workshop_id, number, text, block, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [workshop_id, max[0].num, text.trim(), block || null, max[0].next]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT question — update text, block
app.put("/api/engagement/questions/:id", async (req, res) => {
  const { text, block } = req.body;
  try {
    await pool.query(
      `UPDATE lci_questions SET
         text  = COALESCE($1, text),
         block = COALESCE($2, block)
       WHERE id = $3`,
      [text?.trim() || null, block !== undefined ? (block || null) : undefined, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE question
app.delete("/api/engagement/questions/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM lci_questions WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Connector Registry ────────────────────────────────────────────────────────
//
// Replaces the hardcoded CRM and LexAPI proxies with a dynamic registry stored
// in the database. Any external system can be added via API without code changes.
//
// CRUD:
//   GET    /api/connectors           → list all connectors
//   POST   /api/connectors           → register a new connector
//   PUT    /api/connectors/:name     → update connector settings
//   DELETE /api/connectors/:name     → remove a connector
//
// Proxy (all methods):
//   ANY    /api/connect/:name/*      → forward to the registered system

// List connectors (auth_value redacted)
app.get("/api/connectors", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, label, base_url, auth_type, auth_header, path_prefix, enabled, created_at
       FROM pm_connectors ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register a new connector
app.post("/api/connectors", async (req, res) => {
  const { name, label, base_url, auth_type = "api_key", auth_header = "X-API-Key", auth_value = "", path_prefix = "" } = req.body;
  if (!name || !base_url) return res.status(400).json({ error: "name and base_url required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO pm_connectors (name, label, base_url, auth_type, auth_header, auth_value, path_prefix)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, label, base_url, auth_type, enabled`,
      [name, label || name, base_url, auth_type, auth_header, auth_value, path_prefix]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a connector
app.put("/api/connectors/:name", async (req, res) => {
  const { label, base_url, auth_type, auth_header, auth_value, path_prefix, enabled } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pm_connectors SET
         label       = COALESCE($1, label),
         base_url    = COALESCE($2, base_url),
         auth_type   = COALESCE($3, auth_type),
         auth_header = COALESCE($4, auth_header),
         auth_value  = COALESCE($5, auth_value),
         path_prefix = COALESCE($6, path_prefix),
         enabled     = COALESCE($7, enabled)
       WHERE name = $8
       RETURNING id, name, label, base_url, auth_type, enabled`,
      [label||null, base_url||null, auth_type||null, auth_header||null, auth_value||null, path_prefix||null, enabled??null, req.params.name]
    );
    if (!rows.length) return res.status(404).json({ error: "Connector not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a connector
app.delete("/api/connectors/:name", async (req, res) => {
  try {
    await pool.query(`DELETE FROM pm_connectors WHERE name = $1`, [req.params.name]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generic proxy — forwards ANY method to the registered connector
// /api/connect/:name/some/path?query=x  →  connector.base_url + connector.path_prefix + /some/path?query=x
app.all("/api/connect/:connectorName/*path", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pm_connectors WHERE name = $1 AND enabled = true`,
      [req.params.connectorName]
    );
    if (!rows.length) return res.status(404).json({ error: `Connector '${req.params.connectorName}' not found or disabled` });

    const conn     = rows[0];
    const subPath  = req.params.path ? `/${req.params.path}` : "";
    const query    = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const url      = `${conn.base_url}${conn.path_prefix}${subPath}${query}`;

    const headers  = { "Content-Type": "application/json" };
    if (conn.auth_value) {
      if (conn.auth_type === "bearer") {
        headers["Authorization"] = `Bearer ${conn.auth_value}`;
      } else if (conn.auth_type === "basic") {
        headers["Authorization"] = `Basic ${Buffer.from(conn.auth_value).toString("base64")}`;
      } else {
        headers[conn.auth_header || "X-API-Key"] = conn.auth_value;
      }
    }

    const opts = { method: req.method, headers };
    if (["POST", "PUT", "PATCH"].includes(req.method)) opts.body = JSON.stringify(req.body);

    const upstream = await fetch(url, opts);
    const text     = await upstream.text();
    res.status(upstream.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e) {
    res.status(502).json({ error: `Connector proxy error: ${e.message}` });
  }
});

// Backward-compatible aliases — /api/crm/* and /api/lex/* still work unchanged
async function proxyConnector(connectorName, req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pm_connectors WHERE name = $1 AND enabled = true`,
      [connectorName]
    );
    if (!rows.length) return res.status(404).json({ error: `Connector '${connectorName}' not configured` });
    const conn    = rows[0];
    const url     = `${conn.base_url}${conn.path_prefix}${req.url}`;
    const headers = { "Content-Type": "application/json" };
    if (conn.auth_value) headers[conn.auth_header || "X-API-Key"] = conn.auth_value;
    const opts = { method: req.method, headers };
    if (["POST","PUT","PATCH"].includes(req.method)) opts.body = JSON.stringify(req.body);
    const upstream = await fetch(url, opts);
    const text = await upstream.text();
    res.status(upstream.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e) { res.status(502).json({ error: `${connectorName} unreachable: ${e.message}` }); }
}
app.use("/api/crm", (req, res) => proxyConnector("crm", req, res));
app.use("/api/lex", (req, res) => proxyConnector("lex", req, res));

// ── Maintenance dashboard API ─────────────────────────────────────────────────

// Return all docs that contain at least one maintenanceBlock, with full content
app.get("/api/maintenance", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, content
      FROM   pm_documents
      WHERE  content::text LIKE '%maintenanceBlock%'
      ORDER  BY title
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── IoT Mock Connector ────────────────────────────────────────────────────────
//
// A deterministic mock that returns vibration readings seeded by sensor_id.
// Replace `mockIotReading` with a real connector (InfluxDB, ThingsBoard, etc.)
// without changing any calling code.
//
// Vibration ranges: ok < 2.0 mm/s  |  warning 2.0–3.0  |  alert ≥ 3.0

// Predictable demo sensors — use these IDs to force a specific status:
//   "demo-alert"    → always alert   (~4.2 mm/s)
//   "demo-warning"  → always warning (~2.5 mm/s)
//   "demo-ok"       → always ok      (~0.8 mm/s)
// Any other ID gets a deterministic value based on its hash.
const MOCK_DEMO = {
  "demo-alert":   { base: 4.2, status: "alert"   },
  "demo-warning": { base: 2.5, status: "warning" },
  "demo-ok":      { base: 0.8, status: "ok"      },
};

function mockIotReading(sensorId) {
  if (MOCK_DEMO[sensorId]) {
    const { base, status } = MOCK_DEMO[sensorId];
    const noise = Math.sin(Date.now() / 20000) * 0.1; // tiny drift
    const value = Math.round((base + noise) * 100) / 100;
    return { sensor_id: sensorId, value, unit: "mm/s", metric: "vibration", status, ts: new Date().toISOString() };
  }
  let hash = 0;
  for (const c of String(sensorId)) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  const base  = 0.3 + (hash % 100) * 0.036;
  const noise = Math.sin(Date.now() / 20000 + hash * 0.7) * 0.5;
  const value = Math.max(0.1, Math.round((base + noise) * 100) / 100);
  const status = value >= 3.0 ? "alert" : value >= 2.0 ? "warning" : "ok";
  return { sensor_id: sensorId, value, unit: "mm/s", metric: "vibration", status, ts: new Date().toISOString() };
}

// GET /api/iot/sensors?ids=vib-001,vib-002,…
// Returns live readings for the requested sensor IDs.
app.get("/api/iot/sensors", (req, res) => {
  const ids = (req.query.ids || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json([]);
  res.json(ids.map(mockIotReading));
});

// GET /api/query/critical-machines
// Cross-system JOIN: maintenance docs (PostgreSQL) × IoT readings (mock connector).
// Returns machines ranked by combined_status: critical > warning > watch > ok.
//   critical = overdue tasks AND sensor alerts
//   warning  = overdue tasks OR sensor alerts
//   watch    = sensor warnings only
app.get("/api/query/critical-machines", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, content FROM pm_documents
      WHERE  content::text LIKE '%maintenanceBlock%'
      ORDER  BY title
    `);

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const results = rows.map(row => {
      const blocks = row.content?.content ?? [];
      const tasks  = blocks
        .filter(b => b.type === "maintenanceBlock")
        .flatMap(b => b.attrs?.tasks ?? []);
      const bom    = blocks.find(b => b.type === "bomBlock")?.attrs?.tree ?? null;

      // ── Overdue tasks ──────────────────────────────────────────────────────
      const overdue = tasks.filter(t =>
        t.status !== "done" && t.scheduled_date && new Date(t.scheduled_date) < today
      );

      // ── Collect sensor IDs from the BOM tree ───────────────────────────────
      const sensorIds = [];
      function collectSensors(node) {
        if (node.sensor_id) sensorIds.push(node.sensor_id);
        (node.children ?? []).forEach(collectSensors);
      }
      if (bom) collectSensors(bom);

      const readings = sensorIds.map(mockIotReading);
      const alerts   = readings.filter(r => r.status === "alert");
      const warnings = readings.filter(r => r.status === "warning");

      let combined_status = "ok";
      if      (overdue.length > 0 && alerts.length > 0) combined_status = "critical";
      else if (overdue.length > 0 || alerts.length > 0) combined_status = "warning";
      else if (warnings.length > 0)                     combined_status = "watch";

      return {
        doc_id:          row.id,
        doc_title:       row.title,
        overdue_count:   overdue.length,
        overdue_tasks:   overdue.map(t => ({ component: t.component_name, type: t.task_type, date: t.scheduled_date })),
        sensor_count:    sensorIds.length,
        sensor_alerts:   alerts,
        sensor_warnings: warnings,
        all_readings:    readings,
        combined_status,
      };
    });

    const order = { critical: 0, warning: 1, watch: 2, ok: 3 };
    results.sort((a, b) => (order[a.combined_status] ?? 9) - (order[b.combined_status] ?? 9));

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Asset Registry — routed via the generic connector proxy ──────────────────
// Search assets:  GET /api/connect/asset-registry/assets?search=pump&limit=20
// Get one asset:  GET /api/connect/asset-registry/assets/:id
// The connector base URL is stored in pm_connectors (name = 'asset-registry')
// and can be changed at runtime via PUT /api/connectors/asset-registry.

// ── Asset mention queries ─────────────────────────────────────────────────────

// GET /api/asset-mentions?assetId=<uuid>   → documents that reference this asset
// GET /api/asset-mentions?docId=<id>        → assets referenced in this document
app.get("/api/asset-mentions", async (req, res) => {
  const { assetId, docId } = req.query;
  try {
    if (assetId) {
      const { rows } = await pool.query(
        `SELECT m.document_id, m.tag, m.display, m.mention_count, m.last_seen_at,
                d.title
         FROM pm_asset_document_mention m
         JOIN pm_documents d ON d.id = m.document_id
         WHERE m.asset_id = $1
         ORDER BY m.last_seen_at DESC`,
        [assetId]
      );
      return res.json(rows);
    }
    if (docId) {
      const { rows } = await pool.query(
        `SELECT asset_id, tag, display, mention_count, first_seen_at, last_seen_at
         FROM pm_asset_document_mention
         WHERE document_id = $1
         ORDER BY tag`,
        [docId]
      );
      return res.json(rows);
    }
    res.status(400).json({ error: "Provide assetId or docId query parameter" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Audit log ─────────────────────────────────────────────────────────────────

// GET /api/audit-log?method=GET&path=/api/docs&status=200&from=2026-04-01&to=2026-04-30&limit=100&offset=0
app.get("/api/audit-log", async (req, res) => {
  const { method, path: p, status, from, to } = req.query;
  const limit  = Math.min(parseInt(req.query.limit  || "100"), 500);
  const offset = parseInt(req.query.offset || "0");

  const conds  = [];
  const params = [];
  let   i      = 1;

  if (method) { conds.push(`method = $${i++}`);      params.push(method.toUpperCase()); }
  if (p)      { conds.push(`path ILIKE $${i++}`);    params.push(`%${p}%`); }
  if (status) { conds.push(`status = $${i++}`);      params.push(parseInt(status)); }
  if (from)   { conds.push(`ts >= $${i++}`);         params.push(from); }
  if (to)     { conds.push(`ts <= $${i++}::date + 1`); params.push(to); }

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  try {
    const [{ rows: logs }, { rows: [{ total }] }] = await Promise.all([
      pool.query(
        `SELECT * FROM pm_audit_log ${where} ORDER BY ts DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM pm_audit_log ${where}`, params),
    ]);
    res.json({ logs, total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/audit-log — clear all logs (admin use)
app.delete("/api/audit-log", async (_req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM pm_audit_log");
    res.json({ deleted: rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`API server → http://localhost:${PORT}`)
    );
  })
  .catch(e => {
    console.error("Failed to connect to database:", e.message);
    process.exit(1);
  });
