import { app } from "electron";
import path from "node:path";

/**
 * Resolve on-disk locations for both dev and packaged runs.
 *
 * Dev: compiled Electron code is under packages/widget/dist, the server under
 * packages/server/dist. Packaged: electron-builder copies the server bundle and
 * web assets under resources/ (see electron-builder config).
 */

/**
 * Directory holding the bundled server + its resources (config/, assets/, web/).
 * The widget build produces this at dist/server for both dev and packaged runs,
 * so the layout is identical whether we run from source or an installed app.
 */
export function serverBundleDir(): string {
  // dist/src/paths.js -> dist/src -> dist -> dist/server
  return path.join(__dirname, "..", "server");
}

/** Entry point of the background server process (esbuild ESM bundle). */
export function serverEntry(): string {
  return path.join(serverBundleDir(), "index.mjs");
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

/**
 * Config locations used by earlier versions, for one-time migration so an
 * update never loses saved API keys. (rc.1 stored under the scoped package
 * name before app.setName("AI Pulse") moved userData to %APPDATA%\AI Pulse.)
 */
export function legacyConfigPaths(): string[] {
  const appData = app.getPath("appData"); // %APPDATA% (Roaming)
  return [
    path.join(appData, "@ai-pulse", "widget", "config.json"),
    path.join(appData, "@ai-pulse", "config.json"),
    path.join(appData, "ai-pulse", "config.json"),
  ];
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
