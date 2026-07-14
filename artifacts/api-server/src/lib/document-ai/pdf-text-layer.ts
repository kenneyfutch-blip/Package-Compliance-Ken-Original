// Digital-PDF fast path for document extraction.
//
// Design/artwork and label PDFs almost always ship with a real embedded text
// layer. Reading it directly with poppler's `pdftotext` is effectively free and
// instant, so we do that BEFORE falling back to an AI Vision OCR round-trip.
// Only scanned/flattened image PDFs (no usable text layer) fall through to the
// active OCR provider. This is the single biggest lever for bulk throughput and
// cost, since a bulk import is dominated by digital PDFs.
//
// `pdftotext` is provided by the `poppler-utils` system dependency (already
// declared for thumbnail rendering), so it is always present at runtime.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import type { ExtractionPage } from "@workspace/db";
import { extractHeuristicComponents } from "./components";
import type { OcrExtractionResult } from "./providers/types";

// Persisted to document_extractions.engine / packages.extractionEngine when the
// embedded text layer is used instead of an OCR provider. Treat as a permanent
// contract value (renaming it would orphan cached rows), exactly like a provider id.
export const PDF_TEXT_LAYER_ENGINE_ID = "pdf-text-layer";
export const PDF_TEXT_LAYER_LABEL = "PDF text layer";

const PDFTOTEXT_TIMEOUT_MS = 20_000;

// Minimum non-whitespace characters for a PDF's text layer to count as "real".
// Scanned/flattened PDFs typically yield zero (or a tiny amount of stray) text
// from pdftotext; a genuine digital PDF yields far more, even for a sparse label.
// Below this we treat the document as image-only and fall back to Vision OCR.
const MIN_TEXT_LAYER_CHARS = 24;

function nonWhitespaceLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

async function pdfPageCount(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return Math.max(1, doc.getPageCount());
  } catch {
    return 1;
  }
}

// Run `pdftotext` over the PDF bytes and return the extracted text, or null if
// the tool fails/times out (caller then falls back to the OCR provider).
async function runPdftotext(bytes: Buffer): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "pkg-pdftext-"));
  const inPath = join(dir, "in.pdf");
  const outPath = join(dir, "out.txt");
  try {
    await writeFile(inPath, bytes);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "pdftotext",
        ["-q", "-enc", "UTF-8", "-eol", "unix", inPath, outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("pdftotext timed out"));
      }, PDFTOTEXT_TIMEOUT_MS);
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`pdftotext spawn failed: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`pdftotext exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
    return await readFile(outPath, "utf-8");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Attempt to extract a PDF's embedded text layer without any AI call. Returns a
 * fully-formed extraction result when the text layer is rich enough to trust, or
 * null when the PDF has no usable text (scanned/image PDF) so the caller falls
 * back to the OCR provider (Vision). Never throws — failures resolve to null.
 */
export async function extractPdfTextLayer(
  bytes: Buffer,
): Promise<OcrExtractionResult | null> {
  let raw: string | null;
  try {
    raw = await runPdftotext(bytes);
  } catch {
    return null;
  }
  if (raw == null) return null;

  const text = raw.trim();
  if (nonWhitespaceLength(text) < MIN_TEXT_LAYER_CHARS) {
    // No meaningful text layer — almost certainly a scanned/flattened PDF.
    return null;
  }

  const pageCount = await pdfPageCount(bytes);

  // A flat transcript with no per-block layout/bbox, mirrored on the same shape
  // the Vision provider emits so downstream reasoning/UI stay provider-agnostic.
  const pages: ExtractionPage[] = [
    {
      pageNumber: 1,
      width: 0,
      height: 0,
      blocks: [{ text, confidence: null, bbox: null }],
    },
  ];

  // Same deterministic heuristics the OCR providers apply to their transcripts.
  const components = extractHeuristicComponents(text, []);

  return {
    text,
    pages,
    components,
    confidence: null,
    pageCount,
    processor: `${PDF_TEXT_LAYER_ENGINE_ID}:pdftotext`,
  };
}
