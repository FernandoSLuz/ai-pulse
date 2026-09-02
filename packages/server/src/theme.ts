import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Omarchy theme bridge. Omarchy keeps the active palette as a flat TOML file
 * (`key = "#rrggbb"`) under ~/.local/state/omarchy/current/theme/colors.toml
 * and swaps the whole directory on every `omarchy theme set`. We map those
 * colors onto the CSS custom properties the dashboard and the leaderboard
 * already use (packages/web/styles.css :root) and serve them as /theme.css.
 *
 * Off Omarchy (Windows, no file) the stylesheet is empty and the built-in
 * palette stays untouched.
 */

export interface ThemeInfo {
  available: boolean;
  name: string | null;
  source: string | null;
  colors: Record<string, string>;
  css: string;
  version: number;
}

const OMARCHY_STATE = path.join(os.homedir(), ".local", "state", "omarchy", "current");
const COLORS_FILE = process.env.OMARCHY_THEME_COLORS ?? path.join(OMARCHY_STATE, "theme", "colors.toml");
const NAME_FILE = path.join(OMARCHY_STATE, "theme.name");

/** CSS variable -> ordered list of palette keys to try. */
const CSS_MAP: [string, string[]][] = [
  ["--bg", ["background"]],
  ["--bg-card", ["lighter_background", "background"]],
  ["--bg-hover", ["selection", "lighter_background"]],
  ["--border", ["muted", "selection"]],
  ["--text", ["foreground"]],
  ["--muted", ["light_foreground", "dark_foreground", "foreground"]],
  ["--accent", ["accent", "blue"]],
  ["--accent-dim", ["blue", "accent"]],
  ["--gold", ["yellow", "orange"]],
  ["--success", ["green"]],
  ["--danger", ["red"]],
];

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Minimal parser for Omarchy's flat colors.toml (`key = "#hex"`, comments, no tables). */
export function parseColorsToml(text: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#(?![0-9a-fA-F]{6}\b).*$/, "").trim(); // strip comments, keep #hex
    const m = /^([A-Za-z0-9_]+)\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (!m) continue;
    if (HEX.test(m[2])) colors[m[1]] = m[2].toLowerCase();
  }
  return colors;
}

export function buildThemeCss(colors: Record<string, string>): string {
  const decls: string[] = [];
  for (const [cssVar, keys] of CSS_MAP) {
    const value = keys.map((k) => colors[k]).find(Boolean);
    if (value) decls.push(`  ${cssVar}: ${value};`);
  }
  if (decls.length === 0) return "";
  return `/* Omarchy theme */\n:root {\n${decls.join("\n")}\n}\n`;
}

let current: ThemeInfo = { available: false, name: null, source: null, colors: {}, css: "", version: 0 };
let listeners: ((info: ThemeInfo) => void)[] = [];
let watcher: fs.FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

function readTheme(): ThemeInfo {
  try {
    const text = fs.readFileSync(COLORS_FILE, "utf8");
    const colors = parseColorsToml(text);
    let name: string | null = null;
    try {
      name = fs.readFileSync(NAME_FILE, "utf8").trim() || null;
    } catch {
      /* optional */
    }
    return { available: true, name, source: COLORS_FILE, colors, css: buildThemeCss(colors), version: current.version + 1 };
  } catch {
    return { available: false, name: null, source: null, colors: {}, css: "", version: current.version + 1 };
  }
}

export function getTheme(): ThemeInfo {
  return current;
}

/** Re-read the palette; notifies listeners only when the CSS actually changed. */
export function reloadTheme(): ThemeInfo {
  const next = readTheme();
  const changed = next.css !== current.css || next.name !== current.name || next.available !== current.available;
  current = changed ? next : { ...current };
  if (changed) {
    console.log(`[Theme] ${current.available ? `Omarchy theme "${current.name ?? "?"}" (${Object.keys(current.colors).length} colors)` : "no Omarchy theme file"}`);
    for (const cb of listeners) cb(current);
  }
  return current;
}

export function onThemeChange(cb: (info: ThemeInfo) => void): void {
  listeners.push(cb);
}

/**
 * Load the palette and watch Omarchy's `current` directory: `omarchy theme set`
 * replaces the whole `theme` subdirectory, which shows up as a rename event
 * on the parent. Debounced, best effort — the theme-set hook also POSTs
 * /api/theme/reload for the cases inotify misses.
 */
export function initTheme(): ThemeInfo {
  reloadTheme();
  const dir = path.dirname(path.dirname(COLORS_FILE));
  try {
    if (fs.existsSync(dir)) {
      watcher = fs.watch(dir, { persistent: false }, () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => reloadTheme(), 400);
      });
      watcher.on("error", () => watcher?.close());
    }
  } catch {
    /* watching is optional */
  }
  return current;
}

export function stopTheme(): void {
  watcher?.close();
  watcher = null;
  listeners = [];
}
