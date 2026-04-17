/**
 * store/docStore.js
 *
 * Async document store backed by the Express/PostgreSQL API at /api/docs.
 * The interface is identical to the old localStorage version — only the
 * implementations are async now.
 *
 * All callers must await these methods.
 */

const API = "http://localhost:3001/api/docs";

// ── UUID ─────────────────────────────────────────────────────────────────────

export function randomId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Store API ─────────────────────────────────────────────────────────────────

export const docStore = {

  // Create a new document with an optional initial ProseMirror JSON.
  async create(id, title, initialJSON = null) {
    const content = initialJSON ?? {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: title }],
        },
        { type: "paragraph", content: [] },
      ],
    };
    await fetch(API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id, content, title }),
    });
    return content;
  },

  // Load a document's ProseMirror JSON by ID. Returns null if not found.
  async load(id) {
    const res = await fetch(`${API}/${id}`).catch(() => ({ ok: false }));
    if (!res.ok) return null;
    const row = await res.json();
    return row.content ?? null;
  },

  // Persist a document (called on every transaction).
  async save(id, docJSON, title) {
    await fetch(`${API}/${id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ content: docJSON, title }),
    });
  },

  // Load document metadata (title, createdAt, updatedAt).
  async meta(id) {
    const res = await fetch(`${API}/${id}`).catch(() => ({ ok: false }));
    if (!res.ok) return null;
    const row = await res.json();
    return {
      title:     row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  // Delete a document.
  async delete(id) {
    await fetch(`${API}/${id}`, { method: "DELETE" });
  },

  // List all stored document IDs.
  async list() {
    const res = await fetch(API).catch(() => ({ ok: false }));
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => r.id);
  },

  // Check if a document exists.
  async exists(id) {
    const res = await fetch(`${API}/${id}`).catch(() => ({ ok: false }));
    return res.ok;
  },
};
