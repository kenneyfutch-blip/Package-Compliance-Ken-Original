import { v1 } from "@google-cloud/documentai";
import type { google } from "@google-cloud/documentai/build/protos/protos";
import type {
  ExtractionBbox,
  ExtractionBlock,
  ExtractionPage,
  ExtractedComponent,
} from "@workspace/db";
import {
  DocumentAiUnavailableError,
  getDocumentAiConfig,
} from "./config";
import { extractHeuristicComponents, mapEntityType } from "./components";
import { logger } from "../logger";

type IDocument = google.cloud.documentai.v1.IDocument;
type ITextAnchor = google.cloud.documentai.v1.Document.ITextAnchor;
type INormalizedVertex = google.cloud.documentai.v1.INormalizedVertex;

export type DocumentAiResult = {
  text: string;
  pages: ExtractionPage[];
  components: ExtractedComponent[];
  confidence: number | null;
  pageCount: number;
  processor: string;
};

let cachedClient: v1.DocumentProcessorServiceClient | null = null;

// Lazily construct the client so importing this module never touches
// credentials or network. Constructed only when Document AI is configured.
function getClient(): v1.DocumentProcessorServiceClient {
  if (cachedClient) return cachedClient;
  const config = getDocumentAiConfig();
  cachedClient = new v1.DocumentProcessorServiceClient({
    apiEndpoint: `${config.location}-documentai.googleapis.com`,
    projectId: config.projectId,
    credentials: config.credentials,
  });
  return cachedClient;
}

function processorName(): string {
  const { projectId, location, processorId } = getDocumentAiConfig();
  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

// Resolve the substring of `fullText` referenced by a Document AI text anchor.
function textFromAnchor(
  fullText: string,
  anchor: ITextAnchor | null | undefined,
): string {
  if (!anchor?.textSegments?.length) return "";
  let out = "";
  for (const seg of anchor.textSegments) {
    const start = Number(seg.startIndex ?? 0);
    const end = Number(seg.endIndex ?? 0);
    if (end > start) out += fullText.slice(start, end);
  }
  return out.trim();
}

// Convert normalized vertices (0..1) into an {x,y,w,h} bounding box.
function bboxFromVertices(
  vertices: INormalizedVertex[] | null | undefined,
): ExtractionBbox | null {
  if (!vertices?.length) return null;
  const xs = vertices.map((v) => Number(v.x ?? 0));
  const ys = vertices.map((v) => Number(v.y ?? 0));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

function normalizePages(doc: IDocument): {
  pages: ExtractionPage[];
  confidences: number[];
} {
  const fullText = doc.text ?? "";
  const pages: ExtractionPage[] = [];
  const confidences: number[] = [];

  for (const [index, page] of (doc.pages ?? []).entries()) {
    const pageNumber = Number(page.pageNumber ?? index + 1);
    const width = Number(page.dimension?.width ?? 0);
    const height = Number(page.dimension?.height ?? 0);

    // Prefer coarser structural units for readable blocks; fall back through
    // paragraphs and lines depending on what the processor populated.
    const units =
      (page.blocks?.length && page.blocks) ||
      (page.paragraphs?.length && page.paragraphs) ||
      (page.lines?.length && page.lines) ||
      [];

    const blocks: ExtractionBlock[] = [];
    for (const unit of units) {
      const layout = unit.layout;
      const text = textFromAnchor(fullText, layout?.textAnchor);
      if (!text) continue;
      const confidence =
        layout?.confidence != null ? Number(layout.confidence) : null;
      if (confidence != null) confidences.push(confidence);
      blocks.push({
        text,
        confidence,
        bbox: bboxFromVertices(layout?.boundingPoly?.normalizedVertices),
      });
    }

    pages.push({ pageNumber, width, height, blocks });
  }

  return { pages, confidences };
}

// Layout Parser returns a hierarchical documentLayout rather than page tokens.
// Flatten its text blocks so we still capture per-block text (bbox unavailable).
function normalizeLayoutBlocks(doc: IDocument): ExtractionPage[] {
  const layout = doc.documentLayout;
  if (!layout?.blocks?.length) return [];

  const byPage = new Map<number, ExtractionBlock[]>();

  const walk = (
    blocks: google.cloud.documentai.v1.Document.DocumentLayout.IDocumentLayoutBlock[],
  ): void => {
    for (const block of blocks) {
      const pageNumber = Number(block.pageSpan?.pageStart ?? 1) || 1;
      const text = block.textBlock?.text?.trim();
      if (text) {
        const list = byPage.get(pageNumber) ?? [];
        list.push({ text, confidence: null, bbox: null });
        byPage.set(pageNumber, list);
      }
      if (block.textBlock?.blocks?.length) walk(block.textBlock.blocks);
    }
  };
  walk(layout.blocks);

  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, blocks]) => ({
      pageNumber,
      width: 0,
      height: 0,
      blocks,
    }));
}

// Map Document AI ML entities (populated by custom/specialized extractors) to
// our component taxonomy. Layout Parser returns none — that's expected.
function componentsFromEntities(doc: IDocument): ExtractedComponent[] {
  const fullText = doc.text ?? "";
  const out: ExtractedComponent[] = [];
  for (const entity of doc.entities ?? []) {
    const rawText = entity.mentionText || textFromAnchor(fullText, entity.textAnchor);
    if (!rawText) continue;
    const pageRef = entity.pageAnchor?.pageRefs?.[0];
    out.push({
      type: mapEntityType(entity.type ?? ""),
      text: rawText.trim(),
      confidence: entity.confidence != null ? Number(entity.confidence) : null,
      page: pageRef?.page != null ? Number(pageRef.page) + 1 : null,
      bbox: bboxFromVertices(pageRef?.boundingPoly?.normalizedVertices),
      source: "documentai",
    });
  }
  return out;
}

/**
 * Send a document to Google Document AI and normalize the result. Callers must
 * ensure Document AI is configured (isDocumentAiConfigured) before invoking.
 */
export async function processDocument(input: {
  content: Buffer;
  mimeType: string;
}): Promise<DocumentAiResult> {
  const client = getClient();
  const name = processorName();

  let doc: IDocument;
  try {
    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: input.content,
        mimeType: input.mimeType,
      },
    });
    if (!result.document) {
      throw new DocumentAiUnavailableError(
        "Document AI returned an empty document",
      );
    }
    doc = result.document;
  } catch (err) {
    if (err instanceof DocumentAiUnavailableError) throw err;
    logger.error({ err }, "Document AI processDocument failed");
    throw new DocumentAiUnavailableError(
      err instanceof Error ? err.message : "Document AI request failed",
    );
  }

  const text = doc.text ?? "";
  const { pages: tokenPages, confidences } = normalizePages(doc);
  const pages = tokenPages.length ? tokenPages : normalizeLayoutBlocks(doc);

  // Components: prefer ML entities, always augment with deterministic pattern
  // matches over the OCR text (Net Weight, EPA Reg #, Lot Codes, dates, UPC).
  const entityComponents = componentsFromEntities(doc);
  const heuristicComponents = extractHeuristicComponents(text, entityComponents);
  const components = [...entityComponents, ...heuristicComponents];

  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null;

  const pageCount = pages.length || (doc.pages?.length ?? 0);

  return {
    text,
    pages,
    components,
    confidence,
    pageCount,
    processor: name,
  };
}
