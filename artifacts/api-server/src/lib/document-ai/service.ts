import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Request } from "express";
import {
  db,
  documentExtractionsTable,
  packagesTable,
  type DocumentExtractionRow,
  type PackageRow,
  type ProofRow,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { orgId } from "../rbac/context";
import { writeAudit } from "../audit";
import { logger } from "../logger";
import { getActiveProvider } from "./providers/registry";
import type { OcrProvider } from "./providers/types";

const objectStorage = new ObjectStorageService();

type SourceDocument = {
  bytes: Buffer;
  mimeType: string;
  name: string;
  type: "artwork" | "proof";
  hash: string;
};

export type ExtractionOutcome =
  | "NotConfigured"
  | "Skipped"
  | "Unsupported"
  | "Cached"
  | "Complete"
  | "Failed";

export type ExtractionRunResult = {
  outcome: ExtractionOutcome;
  extraction: DocumentExtractionRow | null;
  message?: string;
};

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "document";
}

// Resolve the raw bytes of the document to extract. Prefers an explicit proof
// (version upload) and otherwise falls back to the package artwork, supporting
// object-storage paths, data URLs, and remote URLs.
async function resolveSource(
  pkg: PackageRow,
  proof: ProofRow | undefined,
  provider: OcrProvider,
): Promise<SourceDocument | null> {
  if (proof) {
    const file = await objectStorage.getObjectEntityFile(proof.objectPath);
    const { buffer, contentType } = await objectStorage.downloadObjectBytes(file);
    return {
      bytes: buffer,
      mimeType: provider.normalizeMimeType(proof.contentType || contentType),
      name: proof.fileName || fileNameFromPath(proof.objectPath),
      type: "proof",
      hash: sha256(buffer),
    };
  }

  const artworkUrl = pkg.artworkUrl;
  if (!artworkUrl) return null;

  // Stored object.
  if (artworkUrl.startsWith("/objects/")) {
    const file = await objectStorage.getObjectEntityFile(artworkUrl);
    const { buffer, contentType } = await objectStorage.downloadObjectBytes(file);
    return {
      bytes: buffer,
      mimeType: provider.normalizeMimeType(contentType),
      name: fileNameFromPath(artworkUrl),
      type: "artwork",
      hash: sha256(buffer),
    };
  }

  // Inline data URL.
  if (artworkUrl.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(artworkUrl);
    if (!match) return null;
    const mime = provider.normalizeMimeType(match[1] || "application/octet-stream");
    const buffer = match[2]
      ? Buffer.from(match[3] ?? "", "base64")
      : Buffer.from(decodeURIComponent(match[3] ?? ""), "utf-8");
    return {
      bytes: buffer,
      mimeType: mime,
      name: "artwork",
      type: "artwork",
      hash: sha256(buffer),
    };
  }

  // Remote/external URLs are intentionally NOT fetched here. Doing so from the
  // server would allow SSRF against internal networks via attacker-controlled
  // artwork URLs. Only trusted object-storage paths and inline data URLs (both
  // minted/validated by this server) are accepted as extraction sources.
  return null;
}

/** Latest extraction row for a package (any status). */
export async function getLatestExtraction(
  packageId: number,
): Promise<DocumentExtractionRow | null> {
  const [row] = await db
    .select()
    .from(documentExtractionsTable)
    .where(eq(documentExtractionsTable.packageId, packageId))
    .orderBy(desc(documentExtractionsTable.id))
    .limit(1);
  return row ?? null;
}

// Cache lookup keyed strictly by source content hash: if this package already
// has a Complete extraction for the exact same source bytes, that is a cache
// hit regardless of any newer rows. Scoped to the package so extractions never
// leak across packages/organizations.
async function getCompletedExtractionByHash(
  packageId: number,
  sourceHash: string,
): Promise<DocumentExtractionRow | null> {
  const [row] = await db
    .select()
    .from(documentExtractionsTable)
    .where(
      and(
        eq(documentExtractionsTable.packageId, packageId),
        eq(documentExtractionsTable.sourceHash, sourceHash),
        eq(documentExtractionsTable.status, "Complete"),
      ),
    )
    .orderBy(desc(documentExtractionsTable.id))
    .limit(1);
  return row ?? null;
}

/** Full extraction history for a package (newest first). */
export async function listExtractions(
  packageId: number,
): Promise<DocumentExtractionRow[]> {
  return db
    .select()
    .from(documentExtractionsTable)
    .where(eq(documentExtractionsTable.packageId, packageId))
    .orderBy(desc(documentExtractionsTable.id));
}

/**
 * Run Google Document AI against a package (or a specific proof/version) and
 * cache the result. This is the ONLY function that invokes Document AI.
 *
 * Caching contract: if a completed extraction already exists for the same
 * source bytes (matching sourceHash) and `force` is false, the cached row is
 * returned and Document AI is NOT called again. Document AI therefore only runs
 * on genuinely new/changed source documents or an explicit reprocess.
 */
export async function runExtraction(params: {
  req: Request;
  pkg: PackageRow;
  proof?: ProofRow;
  force?: boolean;
}): Promise<ExtractionRunResult> {
  const { req, pkg, proof, force = false } = params;
  const provider = getActiveProvider();

  if (!provider.isConfigured()) {
    await db
      .update(packagesTable)
      .set({ extractionStatus: "NotConfigured" })
      .where(eq(packagesTable.id, pkg.id));
    return { outcome: "NotConfigured", extraction: null };
  }

  let source: SourceDocument | null;
  try {
    source = await resolveSource(pkg, proof, provider);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { outcome: "Skipped", extraction: null, message: "Source not found" };
    }
    throw err;
  }

  if (!source) {
    await db
      .update(packagesTable)
      .set({ extractionStatus: "Skipped" })
      .where(eq(packagesTable.id, pkg.id));
    return {
      outcome: "Skipped",
      extraction: null,
      message: "No source document to extract",
    };
  }

  if (!provider.supportedMimeTypes().has(source.mimeType)) {
    await db
      .update(packagesTable)
      .set({ extractionStatus: "Failed" })
      .where(eq(packagesTable.id, pkg.id));
    return {
      outcome: "Unsupported",
      extraction: null,
      message: `Unsupported document type: ${source.mimeType}`,
    };
  }

  // Cache hit: same source document already fully extracted. Never re-run
  // Document AI for identical source bytes unless the caller forces it.
  if (!force) {
    const cached = await getCompletedExtractionByHash(pkg.id, source.hash);
    if (cached) {
      return { outcome: "Cached", extraction: cached };
    }
  }

  const organizationId = orgId(req);
  const version = proof?.version ?? 1;

  const [pending] = await db
    .insert(documentExtractionsTable)
    .values({
      organizationId,
      packageId: pkg.id,
      proofId: proof?.id ?? null,
      version,
      sourceHash: source.hash,
      sourceType: source.type,
      sourceName: source.name,
      status: "Processing",
      engine: provider.id,
    })
    .returning();

  await db
    .update(packagesTable)
    .set({ extractionStatus: "Processing" })
    .where(eq(packagesTable.id, pkg.id));

  try {
    const result = await provider.process({
      content: source.bytes,
      mimeType: source.mimeType,
    });
    const now = new Date();

    const [completed] = await db
      .update(documentExtractionsTable)
      .set({
        status: "Complete",
        text: result.text,
        pages: result.pages,
        components: result.components,
        confidence: result.confidence,
        pageCount: result.pageCount,
        processor: result.processor,
        processedAt: now,
        error: null,
      })
      .where(eq(documentExtractionsTable.id, pending!.id))
      .returning();

    // Feed the extracted text to the reasoning layer (OpenAI reads
    // packages.extractedText). Extraction and reasoning stay separate: we only
    // hand off the text; we do not analyze here.
    await db
      .update(packagesTable)
      .set({
        extractedText: result.text,
        extractionStatus: "Complete",
        extractionConfidence: result.confidence,
        extractionEngine: provider.id,
        extractedAt: now,
      })
      .where(eq(packagesTable.id, pkg.id));

    await writeAudit(req, {
      action: "Document extracted",
      entityType: "package",
      entityId: pkg.id,
      packageId: pkg.id,
      detail: `${provider.label} extracted ${result.pageCount} page(s) and ${result.components.length} component(s) from ${source.name}.`,
    });

    return { outcome: "Complete", extraction: completed! };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    logger.error({ err, packageId: pkg.id }, "Document AI extraction failed");

    const [failed] = await db
      .update(documentExtractionsTable)
      .set({ status: "Failed", error: message })
      .where(eq(documentExtractionsTable.id, pending!.id))
      .returning();

    await db
      .update(packagesTable)
      .set({ extractionStatus: "Failed" })
      .where(eq(packagesTable.id, pkg.id));

    return { outcome: "Failed", extraction: failed!, message };
  }
}
