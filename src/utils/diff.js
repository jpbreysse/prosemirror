/**
 * diff.js
 *
 * Paragraph-level diff engine for ProseMirror documents.
 *
 * Workflow:
 *   1. extractLines(docJson)   — flatten a PM doc JSON into an array of text lines
 *   2. diffLines(oldLines, newLines) — LCS-based diff, returns annotated ops
 *   3. diffStats(ops)          — count additions, deletions, unchanged
 */

// ── Text extraction ───────────────────────────────────────────────────────────

/**
 * Recursively extract all text from a ProseMirror node JSON.
 */
function nodeText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(nodeText).join("");
  return "";
}

/**
 * Convert a ProseMirror doc JSON into an array of { blockType, level, text }
 * objects — one per top-level content block.
 *
 * Blocks with no visible text are skipped (e.g. empty paragraphs, custom
 * atom blocks like charts or maps that have no text equivalent).
 */
export function extractLines(docJson) {
  if (!docJson?.content) return [];

  return docJson.content
    .map(block => {
      // For atom / widget blocks without text, use a placeholder
      const raw = nodeText(block).trim();
      const isAtom = !block.content && raw === "";
      const text = isAtom
        ? `[${block.type} block]`
        : (block.type === "heading"
            ? `${"#".repeat(block.attrs?.level || 1)} ${raw}`
            : raw);

      return text ? { blockType: block.type, level: block.attrs?.level ?? null, text } : null;
    })
    .filter(Boolean);
}

// ── LCS diff ──────────────────────────────────────────────────────────────────

/**
 * Myers / LCS diff over two arrays of line objects.
 * Compares by the .text field.
 *
 * Returns an array of:
 *   { op: "equal" | "delete" | "insert", value: lineObject }
 */
export function diffLines(oldLines, newLines) {
  const a = oldLines.map(l => l.text);
  const b = newLines.map(l => l.text);
  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to reconstruct the diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ op: "equal",  value: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ op: "insert", value: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ op: "delete", value: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function diffStats(ops) {
  return ops.reduce(
    (acc, op) => {
      if (op.op === "insert") acc.added++;
      else if (op.op === "delete") acc.removed++;
      else acc.unchanged++;
      return acc;
    },
    { added: 0, removed: 0, unchanged: 0 }
  );
}
