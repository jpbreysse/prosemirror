/**
 * docxImporter.js
 *
 * Converts a .docx file (Word Open XML) into a ProseMirror doc JSON.
 *
 * Handles:
 *   - Headings (Heading1–Heading6 styles, Title, Subtitle)
 *   - Paragraphs with bold, italic, inline-code marks
 *   - Hyperlinks (URLs resolved from the .rels file)
 *   - Bullet lists and numbered lists
 *   - Tables (converted to ProseMirror table nodes)
 *   - Track changes: <w:ins> is accepted, <w:del> is discarded
 */

import JSZip from "jszip";

// Word XML namespace
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ── Namespace helpers ─────────────────────────────────────────────────────────

function wAll(parent, tag) {
  return Array.from(parent.getElementsByTagNameNS(W, tag));
}

function wFirst(parent, tag) {
  return parent.getElementsByTagNameNS(W, tag)[0] ?? null;
}

function wAttr(el, attr) {
  if (!el) return null;
  return el.getAttributeNS(W, attr) ?? el.getAttribute(`w:${attr}`) ?? null;
}

// ── Relationship file parser ───────────────────────────────────────────────────

function parseRels(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const parser = new DOMParser();
  const doc = parser.parseFromString(relsXml, "text/xml");
  for (const rel of doc.querySelectorAll("Relationship")) {
    const id     = rel.getAttribute("Id");
    const target = rel.getAttribute("Target") || "";
    const type   = rel.getAttribute("Type") || "";
    if (id && type.includes("hyperlink")) map[id] = target;
  }
  return map;
}

// ── Run marks ─────────────────────────────────────────────────────────────────

function getRunMarks(rPr, hyperlinkHref) {
  const marks = [];
  if (!rPr && !hyperlinkHref) return marks;

  if (rPr) {
    const bold = wFirst(rPr, "b") || wFirst(rPr, "bCs");
    if (bold && wAttr(bold, "val") !== "0") marks.push({ type: "strong" });

    const italic = wFirst(rPr, "i") || wFirst(rPr, "iCs");
    if (italic && wAttr(italic, "val") !== "0") marks.push({ type: "em" });

    const rStyle = wFirst(rPr, "rStyle");
    const styleVal = wAttr(rStyle, "val") || "";
    if (/code|verbatim|monospace/i.test(styleVal)) marks.push({ type: "code" });

    const vertAlign = wFirst(rPr, "vertAlign");
    // (superscript / subscript could be added here if needed)
  }

  if (hyperlinkHref) {
    marks.push({ type: "link", attrs: { href: hyperlinkHref, title: null } });
  }

  return marks;
}

// ── Text extraction from a single run ─────────────────────────────────────────

function runToInline(run, hyperlinkHref) {
  const text = wAll(run, "t").map(t => t.textContent).join("");
  if (!text) return null;
  const rPr   = wFirst(run, "rPr");
  const marks = getRunMarks(rPr, hyperlinkHref);
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

// ── Paragraph style detection ─────────────────────────────────────────────────

function getParagraphStyle(pPr) {
  if (!pPr) return { headingLevel: null, listLevel: null, listType: null };

  // Heading level
  const pStyle   = wFirst(pPr, "pStyle");
  const styleVal = wAttr(pStyle, "val") || "";

  const HEADING_MAP = {
    heading1: 1, heading2: 2, heading3: 3, heading4: 4, heading5: 5, heading6: 6,
    title: 1, subtitle: 2,
  };
  let headingLevel = null;
  const normalized = styleVal.replace(/\s/g, "").toLowerCase();
  if (HEADING_MAP[normalized]) {
    headingLevel = HEADING_MAP[normalized];
  } else {
    const m = normalized.match(/^h(?:eading)?(\d)$/);
    if (m) headingLevel = parseInt(m[1]);
  }

  // List detection via numPr
  const numPr   = wFirst(pPr, "numPr");
  let listLevel = null;
  let listType  = null;
  if (numPr) {
    listLevel = parseInt(wAttr(wFirst(numPr, "ilvl"), "val") ?? "0");
    // We'll resolve list type later from numbering.xml if available.
    // For now default to bullet_list; numbered lists will be handled by context.
    listType = "bullet_list";
  }

  return { headingLevel, listLevel, listType };
}

// ── Inline content from a paragraph element ───────────────────────────────────

function extractInline(p, rels) {
  const inline = [];

  for (const child of p.childNodes) {
    const ln = child.localName;

    if (ln === "r") {
      const node = runToInline(child, null);
      if (node) inline.push(node);

    } else if (ln === "ins") {
      // Track-change insertion → accept (include text)
      for (const run of wAll(child, "r")) {
        const node = runToInline(run, null);
        if (node) inline.push(node);
      }

    } else if (ln === "del") {
      // Track-change deletion → discard
      continue;

    } else if (ln === "hyperlink") {
      const rId  = child.getAttributeNS(R_NS, "id") || child.getAttribute("r:id");
      const href = (rId && rels[rId]) ? rels[rId] : (child.getAttribute("w:anchor") ? `#${child.getAttribute("w:anchor")}` : "");
      for (const run of wAll(child, "r")) {
        const node = runToInline(run, href || null);
        if (node) inline.push(node);
      }

    } else if (ln === "bookmarkStart" || ln === "bookmarkEnd" || ln === "proofErr" || ln === "rPrChange" || ln === "pPrChange") {
      // Structural annotations — skip
      continue;
    }
  }

  return inline;
}

// ── Convert a paragraph to a ProseMirror node ─────────────────────────────────

function convertParagraph(p, rels) {
  const pPr = wFirst(p, "pPr");
  const { headingLevel } = getParagraphStyle(pPr);
  const inline = extractInline(p, rels);

  if (headingLevel) {
    return { type: "heading", attrs: { level: headingLevel }, content: inline.length ? inline : [{ type: "text", text: " " }] };
  }

  return { type: "paragraph", content: inline };
}

// ── Convert a table ────────────────────────────────────────────────────────────

function convertTable(tbl, rels) {
  const rows = [];

  for (const tr of wAll(tbl, "tr")) {
    const cells = [];

    for (const tc of wAll(tr, "tc")) {
      const cellContent = [];

      for (const child of tc.childNodes) {
        const ln = child.localName;
        if (ln === "p") {
          cellContent.push(convertParagraph(child, rels));
        } else if (ln === "tbl") {
          // Nested tables — flatten by skipping the nesting
          for (const innerRow of wAll(child, "tr")) {
            for (const innerCell of wAll(innerRow, "tc")) {
              for (const innerP of wAll(innerCell, "p")) {
                cellContent.push(convertParagraph(innerP, rels));
              }
            }
          }
        }
      }

      if (!cellContent.length) cellContent.push({ type: "paragraph", content: [] });
      cells.push({ type: "table_cell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: cellContent });
    }

    if (cells.length) rows.push({ type: "table_row", content: cells });
  }

  if (!rows.length) return null;
  return { type: "table", content: rows };
}

// ── List grouping ─────────────────────────────────────────────────────────────
// Word stores list items as plain paragraphs with numPr attrs.
// Non-consecutive items with the same numId (e.g. numbered sections separated
// by body text) each become their own ordered_list, but the `order` (start)
// attribute is set from the running counter so numbering continues correctly.

function groupLists(nodes) {
  const result = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    if (node._listItem) {
      const listType   = node._listType || "bullet_list";
      const numId      = node._numId    || "";
      const startOrder = node._counter  || 1;
      const listItems  = [];

      // Collect consecutive items with the same numId AND list type
      while (
        i < nodes.length &&
        nodes[i]._listItem &&
        nodes[i]._listType === listType &&
        nodes[i]._numId    === numId
      ) {
        listItems.push({
          type: "list_item",
          content: [{ type: "paragraph", content: nodes[i].content }],
        });
        i++;
      }

      const listNode = {
        type:    listType,
        attrs:   listType === "ordered_list" ? { order: startOrder } : {},
        content: listItems,
      };
      result.push(listNode);
    } else {
      result.push(node);
      i++;
    }
  }

  return result;
}

// ── Main document body converter ──────────────────────────────────────────────

function convertBody(body, rels, numIdMap) {
  const rawNodes   = [];
  const numCounters = new Map(); // numId → next counter value (1-based)

  for (const child of body.childNodes) {
    const ln = child.localName;

    if (ln === "p") {
      const pPr = wFirst(child, "pPr");
      const { headingLevel, listLevel } = getParagraphStyle(pPr);
      const inline = extractInline(child, rels);

      if (headingLevel) {
        rawNodes.push({
          type: "heading",
          attrs: { level: headingLevel },
          content: inline.length ? inline : [{ type: "text", text: " " }],
        });
      } else if (listLevel !== null) {
        // Resolve list type (bullet vs ordered) from numbering.xml map
        const numPr    = wFirst(pPr, "numPr");
        const numIdEl  = wFirst(numPr, "numId");
        const numIdVal = wAttr(numIdEl, "val") || "";
        const resolvedListType = numIdMap.get(numIdVal) || "bullet_list";

        // Track running counter per numId so non-consecutive ordered items
        // continue their numbering across intervening body paragraphs
        const counter = numCounters.get(numIdVal) ?? 1;
        numCounters.set(numIdVal, counter + 1);

        rawNodes.push({
          type: "paragraph",
          content: inline,
          _listItem: true,
          _listType: resolvedListType,
          _numId:    numIdVal,
          _counter:  counter,
        });
      } else {
        rawNodes.push({ type: "paragraph", content: inline });
      }

    } else if (ln === "tbl") {
      const tblNode = convertTable(child, rels);
      if (tblNode) rawNodes.push(tblNode);

    }
    // sectPr and other structural elements are ignored
  }

  // Group consecutive list items into list nodes
  const grouped = groupLists(rawNodes);

  // Remove internal _listItem/_listType flags from anything that slipped through
  for (const n of grouped) {
    delete n._listItem;
    delete n._listType;
  }

  // Trim trailing empty paragraphs
  while (
    grouped.length > 1 &&
    grouped[grouped.length - 1].type === "paragraph" &&
    !grouped[grouped.length - 1].content?.length
  ) {
    grouped.pop();
  }

  // Ensure at least one node
  if (!grouped.length) grouped.push({ type: "paragraph", content: [] });

  return grouped;
}

// ── Numbering.xml parser ──────────────────────────────────────────────────────
// Maps numId → "bullet_list" | "ordered_list"

function parseNumbering(xmlStr) {
  const map = new Map(); // numId → list type
  if (!xmlStr) return map;

  const parser  = new DOMParser();
  const xmlDoc  = parser.parseFromString(xmlStr, "text/xml");

  // abstractNum: abstractNumId → numFmt
  const abstractFmts = new Map();
  for (const an of xmlDoc.getElementsByTagNameNS(W, "abstractNum")) {
    const id   = wAttr(an, "abstractNumId");
    const lvls = an.getElementsByTagNameNS(W, "lvl");
    const fmt  = lvls[0] ? wAttr(wFirst(lvls[0], "numFmt"), "val") : "bullet";
    abstractFmts.set(id, fmt === "bullet" || fmt === "none" ? "bullet_list" : "ordered_list");
  }

  // num: numId → abstractNumId → listType
  for (const num of xmlDoc.getElementsByTagNameNS(W, "num")) {
    const numId      = wAttr(num, "numId");
    const absIdEl    = wFirst(num, "abstractNumId");
    const absId      = wAttr(absIdEl, "val");
    map.set(numId, abstractFmts.get(absId) ?? "bullet_list");
  }

  return map;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a .docx File object and return a ProseMirror doc JSON.
 *
 * Track changes are resolved as "accepted" — insertions kept, deletions dropped.
 */
export async function importDocx(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // 1. Mandatory: document.xml
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid .docx file (missing word/document.xml)");
  const docXmlStr = await docXmlFile.async("string");

  // 2. Optional: relationships (for hyperlink URLs)
  const relsFile  = zip.file("word/_rels/document.xml.rels");
  const relsStr   = relsFile ? await relsFile.async("string") : null;
  const rels      = parseRels(relsStr);

  // 3. Optional: numbering.xml (for bullet vs ordered list detection)
  const numFile   = zip.file("word/numbering.xml");
  const numStr    = numFile ? await numFile.async("string") : null;
  const numIdMap  = parseNumbering(numStr);

  // 4. Parse document.xml
  const parser  = new DOMParser();
  const xmlDoc  = parser.parseFromString(docXmlStr, "text/xml");

  if (xmlDoc.querySelector("parsererror")) {
    throw new Error("Could not parse document XML — the file may be corrupted");
  }

  const body = xmlDoc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("Document body element not found");

  const content = convertBody(body, rels, numIdMap);
  return { type: "doc", content };
}

/**
 * Extract a display title from the converted doc JSON.
 * Uses the first heading or first non-empty paragraph.
 */
export function extractDocTitle(docJson) {
  if (!docJson?.content?.length) return "Imported document";
  for (const node of docJson.content) {
    const text = (node.content || []).map(c => c.text || "").join("").trim();
    if (text) return text.slice(0, 80);
  }
  return "Imported document";
}
