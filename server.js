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

// ── Routes ────────────────────────────────────────────────────────────────────

// Upload an image
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No valid image file received" });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// List all documents (id, title, timestamps — no content)
app.get("/api/docs", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, created_at, updated_at FROM pm_documents ORDER BY updated_at DESC"
    );
    res.json(rows);
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

// ── CRM proxy ─────────────────────────────────────────────────────────────────
// Forwards /api/crm/* → CustomerAPI on port 3002.
// The API key lives here (server-side) and never reaches the browser.

const CRM_BASE    = process.env.CRM_BASE_URL || "http://localhost:3002";
const CRM_API_KEY = process.env.CRM_API_KEY  || "customer-api-dev-key";

app.use("/api/crm", async (req, res) => {
  // req.url is relative to the mount point, e.g. "/customers/123?search=x"
  const url = `${CRM_BASE}/api${req.url}`;

  try {
    const opts = {
      method:  req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    CRM_API_KEY,
      },
    };
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      opts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, opts);
    const text     = await upstream.text();

    res.status(upstream.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e) {
    res.status(502).json({ error: `CRM unreachable: ${e.message}` });
  }
});

// ── LexAPI proxy ──────────────────────────────────────────────────────────────
// Forwards /api/lex/* → LexAPI on port 3003.
// API key stays server-side and never reaches the browser.

const LEX_BASE    = process.env.LEX_BASE_URL || "http://localhost:3003";
const LEX_API_KEY = process.env.LEX_API_KEY  || "lex-api-dev-key";

app.use("/api/lex", async (req, res) => {
  const url = `${LEX_BASE}/api${req.url}`;
  try {
    const opts = {
      method:  req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    LEX_API_KEY,
      },
    };
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      opts.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(url, opts);
    const text     = await upstream.text();
    res.status(upstream.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e) {
    res.status(502).json({ error: `LexAPI unreachable: ${e.message}` });
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
