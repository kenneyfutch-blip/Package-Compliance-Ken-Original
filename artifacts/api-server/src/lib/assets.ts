import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Absolute path to the compliance app's public/ directory, where seed artwork
// lives (/artwork/*.png). Resolved by walking UP from this module until the
// directory is found.
//
// A fixed "up N levels" offset from import.meta.url is fragile: the server runs
// from a bundled dist/index.mjs, which sits at a different depth than the source
// tree it was built from. The previous offset assumed the source layout and, in
// the bundle, resolved one level too high (/home/runner instead of the
// workspace root), so seed artwork silently failed to load and never embedded in
// exported proof PDFs. Walking up until the target exists works in both the
// bundled and source-run cases.
function resolveCompliancePublic(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "artifacts", "compliance", "public");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Historical fallback (source layout: <root>/artifacts/api-server/src/<dir>).
  return path.join(
    path.resolve(start, "..", "..", "..", ".."),
    "artifacts",
    "compliance",
    "public",
  );
}

export const COMPLIANCE_PUBLIC = resolveCompliancePublic();
