// Assembles everything the Electron app needs at runtime into dist/:
//   dist/assets, dist/renderer  — app UI resources
//   dist/server/index.cjs       — the server, bundled by esbuild
//   dist/server/{config,assets,web} — server runtime resources
//
// The server is bundled to a single CJS file with the native/vendored modules
// (better-sqlite3, node-notifier) left external, so normal node_modules
// resolution finds them at runtime (the app ships with asar disabled).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const widgetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(widgetDir, "..", "..");
const serverDir = path.join(repoRoot, "packages", "server");
const webDir = path.join(repoRoot, "packages", "web");
const distDir = path.join(widgetDir, "dist");
const serverOut = path.join(distDir, "server");

// App UI resources.
cpSync(path.join(widgetDir, "assets"), path.join(distDir, "assets"), { recursive: true });
cpSync(path.join(widgetDir, "renderer"), path.join(distDir, "renderer"), { recursive: true });

// Server bundle.
rmSync(serverOut, { recursive: true, force: true });
mkdirSync(serverOut, { recursive: true });

await build({
  entryPoints: [path.join(serverDir, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm", // keeps import.meta.url working; externals interop as CJS
  target: "node20",
  outfile: path.join(serverOut, "index.mjs"),
  external: ["better-sqlite3", "node-notifier"],
  // Provide a real `require` so bundled CJS deps (dotenv, etc.) can require
  // Node builtins under ESM output.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});

// Server runtime resources, resolved via AI_PULSE_RESOURCE_DIR / AI_PULSE_WEB_DIR.
cpSync(path.join(serverDir, "config"), path.join(serverOut, "config"), { recursive: true });
cpSync(path.join(serverDir, "assets"), path.join(serverOut, "assets"), { recursive: true });
cpSync(webDir, path.join(serverOut, "web"), { recursive: true });

console.log("[build] app + server bundle assembled at", distDir);
