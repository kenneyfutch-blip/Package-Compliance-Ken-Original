import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm, glob } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build as esbuild } from "esbuild";

// Node's native TypeScript loader cannot resolve the extension-less relative
// imports emitted inside generated workspace packages (e.g. @workspace/api-zod),
// which are designed to be bundled. So we bundle the test files with esbuild —
// exactly how the app itself is built — then run them with the Node test runner.
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(artifactDir, "dist-test");

async function main() {
  await rm(distDir, { recursive: true, force: true });

  const entryPoints = [];
  for await (const file of glob("src/**/*.test.ts", { cwd: artifactDir })) {
    entryPoints.push(path.resolve(artifactDir, file));
  }
  if (entryPoints.length === 0) {
    console.log("No test files found.");
    return;
  }

  await esbuild({
    entryPoints,
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outbase: path.resolve(artifactDir, "src"),
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
    external: ["*.node", "pg-native"],
    banner: {
      js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);`,
    },
  });

  const child = spawn(
    process.execPath,
    ["--test", `${distDir}/**/*.test.mjs`],
    { stdio: "inherit", cwd: artifactDir },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
