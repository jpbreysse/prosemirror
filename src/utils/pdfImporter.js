/**
 * pdfImporter.js — Import a PDF into ProseMirror with OCR fallback.
 *
 * Flow:
 *  1. Extract text from all pages in parallel (PDF.js).
 *  2. Any page with no extractable text → render to canvas → OCR (Tesseract.js).
 *  3. Assemble pages in order with <horizontal_rule> separators.
 *
 * Both PDF.js and Tesseract.js are lazy-loaded so they don't bloat the initial bundle.
 */

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// ── Lazy loaders ──────────────────────────────────────────────────────────────

let _pdfjs      = null;
let _tesseract  = null;

async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = workerSrc;
  _pdfjs = lib;
  return lib;
}

async function getTesseract() {
  if (_tesseract) return _tesseract;
  _tesseract = await import("tesseract.js");
  return _tesseract;
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * @param {File} file
 * @param {{ onProgress?, onOcr? }} opts
 *   onProgress(current, total)    — called after each page's text is extracted
 *   onOcr(current, total, pageNum) — called before each page's OCR starts
 */
export async function importPdf(file, { onProgress, onOcr } = {}) {
  console.log("[pdfImporter] starting, file:", file.name, file.size);
  const pdfjs  = await getPdfjs();
  console.log("[pdfImporter] PDF.js loaded, workerSrc:", pdfjs.GlobalWorkerOptions.workerSrc);
  const buffer = await file.arrayBuffer();
  console.log("[pdfImporter] buffer ready, bytes:", buffer.byteLength);
  const pdf    = await pdfjs.getDocument({ data: buffer }).promise;
  console.log("[pdfImporter] document loaded, pages:", pdf.numPages);

  const total = pdf.numPages;
  onProgress?.(0, total);

  // ── Phase 1: parallel text extraction ──────────────────────────────────────
  const pages = await Promise.all(
    Array.from({ length: total }, async (_, i) => {
      const pageNum  = i + 1;
      const page     = await pdf.getPage(pageNum);
      const [content, viewport] = await Promise.all([
        page.getTextContent(),
        Promise.resolve(page.getViewport({ scale: 1 })),
      ]);
      const lines = extractLines(content.items, viewport.height);
      const nodes = linesToNodes(lines);
      onProgress?.(pageNum, total);
      return { pageNum, page, nodes, hasText: nodes.some(n => n.content?.length) };
    })
  );

  // ── Phase 2: OCR for pages with no text ────────────────────────────────────
  const ocrPages = pages.filter(p => !p.hasText);

  console.log("[pdfImporter] pages with text:", pages.filter(p => p.hasText).length, "/ OCR needed:", ocrPages.length);

  if (ocrPages.length > 0) {
    console.log("[pdfImporter] loading Tesseract…");
    const { createWorker } = await getTesseract();
    console.log("[pdfImporter] Tesseract loaded, spawning worker…");
    const worker = await createWorker("eng", 1, {
      // suppress verbose Tesseract logging
      logger: m => console.log("[tesseract]", m),
    });
    console.log("[pdfImporter] Tesseract worker ready");

    for (let i = 0; i < ocrPages.length; i++) {
      const { pageNum, page } = ocrPages[i];
      onOcr?.(i + 1, ocrPages.length, pageNum);

      const canvas = await renderPageToCanvas(page);
      const { data: { text } } = await worker.recognize(canvas);
      ocrPages[i].nodes = ocrTextToNodes(text);
    }

    await worker.terminate();
  }

  // ── Assemble in order ─────────────────────────────────────────────────────
  const docNodes = [];
  for (const { pageNum, nodes } of pages) {
    if (pageNum > 1) docNodes.push({ type: "horizontal_rule" });
    docNodes.push(...nodes);
  }

  if (!docNodes.length) docNodes.push({ type: "paragraph", content: [] });
  return { type: "doc", content: docNodes };
}

export function extractPdfTitle(docJson) {
  const first = docJson?.content?.[0];
  if (first?.content?.[0]?.text) return first.content[0].text.slice(0, 80);
  return "Imported PDF";
}

// ── Canvas render (for OCR) ───────────────────────────────────────────────────

async function renderPageToCanvas(page) {
  const viewport = page.getViewport({ scale: 2 }); // 2× for better OCR accuracy
  const canvas   = document.createElement("canvas");
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

// ── OCR text → ProseMirror nodes ─────────────────────────────────────────────

function ocrTextToNodes(text) {
  const nodes = [];
  // Split on blank lines to get paragraph groups
  const blocks = text.split(/\n{2,}/).map(b => b.replace(/\n/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const block of blocks) {
    nodes.push({ type: "paragraph", content: [{ type: "text", text: block }] });
  }
  return nodes;
}

// ── Text extraction ───────────────────────────────────────────────────────────

function extractLines(items, pageHeight) {
  const normalised = items
    .filter(i => i.str?.trim())
    .map(i => {
      const [, , , scaleY, x, y] = i.transform;
      return {
        str:    i.str,
        x,
        y:      pageHeight - y,
        height: Math.abs(scaleY) || Math.abs(i.height) || 10,
      };
    });

  if (!normalised.length) return [];

  normalised.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  const lines = [];
  let cur = [normalised[0]];
  for (let i = 1; i < normalised.length; i++) {
    const item = normalised[i];
    const refY = cur[cur.length - 1].y;
    const refH = cur[cur.length - 1].height;
    if (Math.abs(item.y - refY) <= refH * 0.6) {
      cur.push(item);
    } else {
      lines.push(cur);
      cur = [item];
    }
  }
  lines.push(cur);
  return lines;
}

// ── Lines → ProseMirror nodes ─────────────────────────────────────────────────

function linesToNodes(lines) {
  if (!lines.length) return [];

  const heights = lines.flatMap(l => l.map(i => i.height)).sort((a, b) => a - b);
  const median  = heights[Math.floor(heights.length / 2)] || 10;

  const nodes     = [];
  let   paraLines = [];
  let   lastY     = null;

  const flushParagraph = () => {
    if (!paraLines.length) return;
    const text = paraLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) nodes.push({ type: "paragraph", content: [{ type: "text", text }] });
    paraLines = [];
  };

  for (const line of lines) {
    const text     = line.map(i => i.str).join("").trim();
    if (!text) continue;

    const lineH    = Math.max(...line.map(i => i.height));
    const currentY = line[0].y;
    const gap      = lastY != null ? currentY - lastY : 0;
    lastY = currentY;

    if (gap > lineH * 1.8) flushParagraph();

    const ratio = lineH / median;
    if (ratio >= 1.6) {
      flushParagraph();
      nodes.push({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] });
    } else if (ratio >= 1.25) {
      flushParagraph();
      nodes.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
    } else {
      paraLines.push(text);
    }
  }

  flushParagraph();
  return nodes;
}
