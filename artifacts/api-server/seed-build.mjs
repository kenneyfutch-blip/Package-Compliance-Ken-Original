import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/seed.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(artifactDir, "dist/seed.mjs"),
  logLevel: "error",
  external: [
    "*.node", "sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt",
    "argon2", "fsevents", "re2", "farmhash", "pg-native", "@google-cloud/*",
    "pino", "pino-pretty", "thread-stream", "pino-abstract-transport",
  ],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);`,
  },
});
console.log("seed built");
