import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Server-side artwork thumbnail rendering.
//
// Package cards show a small preview of the current artwork. Rendering PDFs in
// the browser (one full document download + rasterize per card) does not scale —
// a list of N packages downloads N multi-MB PDFs and runs N concurrent renders,
// which is slow and flaky. Instead we rasterize page 1 once on the server with
// poppler's `pdftoppm`, cache the PNG in-process, and let the browser cache it
// too. `pdftoppm` is provided by the `poppler-utils` system dependency, so it is
// available in both the dev container and autoscale deployments.

// Thumbnails are tiny (~40-80 KB) and the working set is small (packages per
// org), so a bounded most-recently-used Map is plenty. On a cache miss we simply
// re-render; nothing is lost when an instance restarts.
const CACHE_MAX = 256;
const cache = new Map<string, Buffer>();

export function getCachedThumbnail(key: string): Buffer | undefined {
  const v = cache.get(key);
  if (v) {
    // Bump recency so the eviction order is least-recently-used.
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

export function setCachedThumbnail(key: string, buf: Buffer): void {
  cache.set(key, buf);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Thrown when a source file cannot be rasterized (not a PDF, corrupt, etc.). */
export class ThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbnailError";
  }
}

// Guard against a pathological PDF hanging the render worker.
const RENDER_TIMEOUT_MS = 15_000;

/**
 * Render page 1 of a PDF (or PDF-compatible file, e.g. many Adobe .ai files) to
 * a PNG thumbnail whose largest dimension is `widthPx`. Returns the PNG bytes.
 * Throws {@link ThumbnailError} if the file cannot be rendered.
 */
export async function renderPdfThumbnail(
  pdf: Buffer,
  opts: { maxDimPx?: number } = {},
): Promise<Buffer> {
  const maxDim = opts.maxDimPx ?? 480;
  const dir = await mkdtemp(join(tmpdir(), "pkg-thumb-"));
  const inPath = join(dir, "in.pdf");
  const outPrefix = join(dir, "out");
  try {
    await writeFile(inPath, pdf);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "pdftoppm",
        [
          "-png",
          "-f",
          "1",
          "-l",
          "1",
          // Scale so the larger dimension is maxDim, preserving aspect ratio.
          "-scale-to",
          String(maxDim),
          "-singlefile",
          inPath,
          outPrefix,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new ThumbnailError("pdftoppm timed out"));
      }, RENDER_TIMEOUT_MS);
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new ThumbnailError(`pdftoppm spawn failed: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new ThumbnailError(
              `pdftoppm exited ${code}: ${stderr.slice(0, 300)}`,
            ),
          );
      });
    });
    return await readFile(`${outPrefix}.png`);
  } catch (e) {
    if (e instanceof ThumbnailError) throw e;
    throw new ThumbnailError(
      `thumbnail render failed: ${(e as Error).message}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      /* best-effort temp cleanup */
    });
  }
}
