import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { getAuth } from '@clerk/express';
import { db } from '@workspace/db';
import {
  packageVersionsTable,
  packagesTable,
  proofsTable,
  reportsTable,
  supplierSubmissionsTable,
} from '@workspace/db';
import { eq, or } from 'drizzle-orm';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { requireAnyPermission } from '../lib/rbac/context';
import { canAccessObjectOwner, type ObjectOwner } from '../lib/rbac/scope';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Server-side upload gate. The actual bytes are uploaded directly to object
// storage via a presigned URL, so this validates the declared metadata before
// a URL is ever issued: enforces a size ceiling and an approved-type allowlist.
// Script/HTML/SVG types are intentionally excluded — those are the stored-XSS
// vectors when a file is later served back from storage. The allowlist covers
// the formats the product actually uses (packaging artwork incl. Adobe .ai/
// .indd, PDFs, images, Office docs, and plain-text policy files).
// Authoritative upload size gate. The client mirrors this value in
// lib/object-storage-web/src/upload-config.ts (MAX_UPLOAD_BYTES) so the UI can
// display and pre-validate the same limit — keep the two in lockstep.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/postscript", // .ai / .eps
  "application/illustrator", // .ai
  "application/x-indesign", // .indd
  "application/octet-stream", // fallback browsers send for .ai / .indd binaries
]);

function validateUpload(
  name: string,
  size: number,
  contentType: string,
): string | null {
  if (!Number.isFinite(size) || size <= 0) return "Invalid file size";
  if (size > MAX_UPLOAD_BYTES) {
    return `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`;
  }
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(type)) {
    return "File type is not allowed";
  }
  // Block obviously dangerous double-extensions / traversal in the file name.
  if (/[\\/]|\.\.|\.(exe|sh|bat|cmd|js|mjs|html?|svg|php|com|scr)$/i.test(name)) {
    return "File name is not allowed";
  }
  return null;
}

/**
 * Reverse-map a private object path (/objects/...) to the record that owns it,
 * so private downloads can be authorized with the same tenant/supplier scoping
 * as the rest of the app. Returns null when no record references the path;
 * callers treat that as "not found" and deny access (deny-by-default).
 */
export async function resolveObjectOwner(
  objectPath: string,
): Promise<ObjectOwner | null> {
  // Proof/version artwork (current file or attached preview) -> owning package.
  const [version] = await db
    .select({ packageId: packageVersionsTable.packageId })
    .from(packageVersionsTable)
    .where(
      or(
        eq(packageVersionsTable.fileUrl, objectPath),
        eq(packageVersionsTable.previewUrl, objectPath),
      ),
    )
    .limit(1);
  let packageId: number | null | undefined = version?.packageId;

  // Package headline artwork -> the package itself.
  if (packageId == null) {
    const [pkg] = await db
      .select({
        organizationId: packagesTable.organizationId,
        supplierId: packagesTable.supplierId,
      })
      .from(packagesTable)
      .where(eq(packagesTable.artworkUrl, objectPath))
      .limit(1);
    if (pkg) {
      return {
        kind: 'package',
        organizationId: pkg.organizationId,
        supplierId: pkg.supplierId,
      };
    }
  }

  // Legacy proof uploads -> owning package.
  if (packageId == null) {
    const [proof] = await db
      .select({ packageId: proofsTable.packageId })
      .from(proofsTable)
      .where(eq(proofsTable.objectPath, objectPath))
      .limit(1);
    packageId = proof?.packageId;
  }

  // Exported (annotated) proof PDFs -> owning package.
  if (packageId == null) {
    const [report] = await db
      .select({ packageId: reportsTable.packageId })
      .from(reportsTable)
      .where(eq(reportsTable.objectPath, objectPath))
      .limit(1);
    packageId = report?.packageId;
  }

  if (packageId != null) {
    const [pkg] = await db
      .select({
        organizationId: packagesTable.organizationId,
        supplierId: packagesTable.supplierId,
      })
      .from(packagesTable)
      .where(eq(packagesTable.id, packageId))
      .limit(1);
    if (!pkg) return null;
    return {
      kind: 'package',
      organizationId: pkg.organizationId,
      supplierId: pkg.supplierId,
    };
  }

  // Supplier submission artwork -> owning supplier (org + supplier scoped).
  const [submission] = await db
    .select({
      organizationId: supplierSubmissionsTable.organizationId,
      supplierId: supplierSubmissionsTable.supplierId,
    })
    .from(supplierSubmissionsTable)
    .where(eq(supplierSubmissionsTable.artworkUrl, objectPath))
    .limit(1);
  if (submission) {
    return {
      kind: 'supplier',
      organizationId: submission.organizationId,
      supplierId: submission.supplierId,
    };
  }

  return null;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  requireAnyPermission('packages:write', 'proofs:write'),
  async (req: Request, res: Response) => {
    // Upstream requireAuth already guarantees a signed-in Dollar Tree user.
    if (!getAuth(req)?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const validationError = validateUpload(name, size, contentType);
      if (validationError) {
        res.status(415).json({ error: validationError });
        return;
      }

      const ext = name.includes('.')
        ? name.slice(name.lastIndexOf('.') + 1)
        : undefined;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL(ext);
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get(
  '/storage/objects/*path',
  requireAnyPermission('proofs:read', 'packages:read'),
  async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Authorize BEFORE touching storage: map the object back to the record that
    // owns it and apply the caller's org/supplier scope. Unknown or out-of-scope
    // objects return 404 so we never confirm their existence or leak another
    // tenant's / supplier's proof artifact to a signed-in but unauthorized user.
    const owner = await resolveObjectOwner(objectPath);
    if (!owner || !canAccessObjectOwner(req, owner)) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }

    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    // Optional forced download. Stored objects live at UUID paths with no
    // extension, so an inline view offers no real filename — the browser just
    // renders the PDF in a tab, leaving nothing to drag into Teams/email. When
    // `?download=<name>` is present we send it as an attachment with a clean
    // filename. The name is sanitized to a safe charset to prevent header
    // injection, and .pdf downloads are forced to application/pdf.
    const requested = req.query.download;
    if (typeof requested === "string" && requested.length > 0) {
      const safe =
        requested.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) || "download";
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safe}"`,
      );
      if (safe.toLowerCase().endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      }
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
