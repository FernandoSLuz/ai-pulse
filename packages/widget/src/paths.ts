import { app } from "electron";
import path from "node:path";

/**
 * Resolve on-disk locations for both dev and packaged runs.
 *
 * Dev: compiled Electron code is under packages/widget/dist, the server under
 * packages/server/dist. Packaged: electron-builder copies the server bundle and
 * web assets under resources/ (see electron-builder config).
 */

/** Entry point of the background server process. */
export function serverEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "server", "dist", "index.js");
  }
  // dist/src/paths.js -> dist/src -> dist -> widget -> packages -> server/dist
  return path.join(__dirname, "..", "..", "..", "server", "dist", "index.js");
}

/** Writable per-user data directory (SQLite DB, etc.). */
export function dataDir(): string {
  return path.join(app.getPath("userData"), "data");
}

/** Log directory for the supervised server's stdout/stderr. */
export function logDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function serverLogPath(): string {
  return path.join(logDir(), "server.log");
}

/** JSON file holding user config (API keys, preferences). */
export function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

/** Renderer HTML for the settings/control window. */
export function settingsHtml(): string {
  return path.join(__dirname, "..", "renderer", "settings.html");
}

/** Preload script for the settings window. */
export function settingsPreload(): string {
  return path.join(__dirname, "..", "preload-settings.js");
}

/** Preload script for the leaderboard window. */
export function leaderboardPreload(): string {
  return path.join(__dirname, "..", "preload.js");
}
