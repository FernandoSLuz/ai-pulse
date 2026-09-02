import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./config";

/**
 * Platform-specific desktop integration. Electron's login-item and protocol
 * APIs are no-ops on Linux, so the app owns its XDG desktop entries itself:
 * one launcher entry (also the aipulse:// handler) and one autostart entry.
 *
 * "ai-pulse" is the single identity shared by the .desktop file name, the
 * Wayland app_id / X11 WM_CLASS (via app.setDesktopName), StartupWMClass,
 * electron-builder's linux.executableName and the Hyprland window rules.
 */

export const isLinux = process.platform === "linux";
export const isWindows = process.platform === "win32";
// HYPRLAND_INSTANCE_SIGNATURE is only exported to processes started by the
// compositor; a terminal/IDE launch may lack it, so also accept the desktop name
// (hyprctl finds a lone instance on its own).
export const isHyprland =
  isLinux && (Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE) || /hyprland/i.test(process.env.XDG_CURRENT_DESKTOP ?? ""));
export const DESKTOP_ID = "ai-pulse";
/** Window title of the leaderboard — a contract with packages/web/widget.html and the Hyprland rules. */
export const LEADERBOARD_TITLE = "AI Pulse Widget";
export const DESKTOP_FILE = `${DESKTOP_ID}.desktop`;
export const PROTOCOL = "aipulse";

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

export function applicationsDir(): string {
  return path.join(xdgDataHome(), "applications");
}

export function autostartDir(): string {
  return path.join(xdgConfigHome(), "autostart");
}

export function launcherDesktopPath(): string {
  return path.join(applicationsDir(), DESKTOP_FILE);
}

export function autostartDesktopPath(): string {
  return path.join(autostartDir(), DESKTOP_FILE);
}

function hicolorIconPath(): string {
  return path.join(xdgDataHome(), "icons", "hicolor", "256x256", "apps", `${DESKTOP_ID}.png`);
}

/** Bundled 256px RGBA icon (dist/assets, copied by build-resources.mjs). */
export function appIconPath(): string {
  return path.join(__dirname, "..", "assets", "app-icon-256.png");
}

/**
 * The argv that relaunches this very installation. An AppImage must be started
 * through its mount point wrapper (APPIMAGE), a packaged build through its
 * binary, and a source checkout through electron + the widget package dir
 * (same as `electron .`, so package.json's desktopName is honored in dev).
 */
export function launcherArgv(): string[] {
  if (process.env.APPIMAGE) return [process.env.APPIMAGE];
  if (app.isPackaged) return [process.execPath];
  return [process.execPath, path.resolve(__dirname, "..", "..")]; // dist/src -> packages/widget
}

/** Desktop Entry spec quoting for one Exec argument (a literal % becomes %%). */
function quoteExecArg(arg: string): string {
  const escaped = arg.replace(/%/g, "%%");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(escaped)) return escaped;
  return `"${escaped.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
}

function execLine(extraArgs: string[]): string {
  return [...launcherArgv(), ...extraArgs].map(quoteExecArg).join(" ");
}

function writeDesktopFile(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
}

/** Fire-and-forget helper; failures are logged, never fatal. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000 }, (err) => {
      if (err) console.warn(`[Desktop] ${cmd} ${args.join(" ")} failed: ${err.message}`);
      resolve();
    });
  });
}

/**
 * Install/refresh the launcher entry and register it as the aipulse:// handler.
 * Idempotent and cheap, so it runs on every start: the launcher path changes
 * whenever an AppImage is updated, and neither AppImages nor source checkouts
 * install a .desktop file on their own.
 */
export async function installDesktopIntegration(): Promise<void> {
  if (!isLinux) return;
  try {
    const icon = hicolorIconPath();
    fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.copyFileSync(appIconPath(), icon);
  } catch (err) {
    console.warn("[Desktop] Icon install failed:", (err as Error).message);
  }
  try {
    writeDesktopFile(launcherDesktopPath(), [
      "[Desktop Entry]",
      "Type=Application",
      "Name=AI Pulse",
      "Comment=Your personal AI model radar",
      `Exec=${execLine([])} %U`,
      `Icon=${DESKTOP_ID}`,
      "Terminal=false",
      "Categories=Utility;",
      `StartupWMClass=${DESKTOP_ID}`,
      `MimeType=x-scheme-handler/${PROTOCOL};`,
    ]);
  } catch (err) {
    console.warn("[Desktop] Launcher entry failed:", (err as Error).message);
    return;
  }
  // xdg-mime writes ~/.config/mimeapps.list directly — that is the registration
  // xdg-open honors. update-desktop-database refreshes the MimeType cache for GIO.
  await run("xdg-mime", ["default", DESKTOP_FILE, `x-scheme-handler/${PROTOCOL}`]);
  await run("update-desktop-database", [applicationsDir()]);
}

/**
 * Start-on-login. Windows keeps Electron's login item; Linux writes an XDG
 * autostart entry, which uwsm's xdg-desktop-autostart.target turns into a
 * systemd user unit at login. Removing the file is how the toggle turns off.
 */
export function applyAutoLaunch(config: AppConfig): void {
  if (isLinux) {
    const file = autostartDesktopPath();
    try {
      if (!config.autoLaunch) {
        fs.rmSync(file, { force: true });
        return;
      }
      writeDesktopFile(file, [
        "[Desktop Entry]",
        "Type=Application",
        "Name=AI Pulse",
        "Comment=AI Pulse background service and tray",
        `Exec=${execLine(config.startHidden ? ["--hidden"] : [])}`,
        `Icon=${DESKTOP_ID}`,
        "Terminal=false",
        "X-GNOME-Autostart-enabled=true",
      ]);
    } catch (err) {
      console.warn("[Desktop] Autostart entry failed:", (err as Error).message);
    }
    return;
  }
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: config.autoLaunch,
      args: config.startHidden ? ["--hidden"] : [],
    });
  }
}

interface HyprClient {
  class: string;
  title: string;
  monitor: number;
}

interface HyprMonitor {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  reserved?: number[]; // [left, top, right, bottom] — the bar's exclusive zone
}

interface HyprMonitorFull extends HyprMonitor {
  name: string;
}

/** Connected monitor names, for the Settings dropdown. Empty off Hyprland. */
export async function hyprlandMonitorNames(): Promise<string[]> {
  if (!isHyprland) return [];
  const monitors = await hyprctlJson<HyprMonitorFull[]>(["monitors"]);
  return (monitors ?? []).map((m) => m.name).filter(Boolean);
}

function hyprctlJson<T>(args: string[]): Promise<T | null> {
  return new Promise((resolve) => {
    execFile("hyprctl", ["-j", ...args], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(out) as T);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Dock a window to a screen edge just below the bar via Hyprland's IPC.
 * The static window rule places the leaderboard on map, but Hyprland keeps
 * a floating window's *center* when the client later resizes itself — and
 * the leaderboard resizes to its content — so re-dock after every resize.
 * No-op outside Hyprland; failures are silent (the rule still applies).
 */
export async function hyprlandDock(
  title: string,
  width: number,
  side: "left" | "right",
  gap: number,
  preferredMonitor = "",
): Promise<void> {
  if (!isHyprland) return;
  const clients = await hyprctlJson<HyprClient[]>(["clients"]);
  const win = clients?.find((c) => c.class === DESKTOP_ID && c.title === title);
  if (!win) return;
  const monitors = await hyprctlJson<HyprMonitorFull[]>(["monitors"]);
  // A preferred monitor wins: moving a floating window to coordinates on
  // another output is what relocates it (Hyprland has no per-window monitor rule).
  const mon =
    (preferredMonitor ? monitors?.find((m) => m.name === preferredMonitor) : undefined) ??
    monitors?.find((m) => m.id === win.monitor) ??
    monitors?.[0];
  if (!mon) return;
  const logicalWidth = Math.round(mon.width / (mon.scale || 1));
  const x = side === "right" ? mon.x + logicalWidth - width : mon.x;
  const y = mon.y + (mon.reserved?.[1] ?? 0) + gap;
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selector = `title:^(${escaped})$`;
  // Hyprland >= 0.55 speaks Lua on the dispatch socket; older versions take the
  // classic "movewindowpixel exact X Y,selector" text. Try Lua first.
  const luaCall = `hl.dsp.window.move({ exact = true, x = ${x}, y = ${y}, window = ${JSON.stringify(selector)} })`;
  const legacy = ["movewindowpixel", `exact ${x} ${y},${selector}`];
  const dispatch = (args: string[]) =>
    new Promise<string>((resolve) => execFile("hyprctl", ["dispatch", ...args], { timeout: 3000 }, (_err, out) => resolve(String(out ?? ""))));
  const result = await dispatch([luaCall]);
  if (!/^ok/m.test(result)) await dispatch(legacy);
}

function hyprctlText(args: string[]): Promise<string> {
  return new Promise((resolve) => execFile("hyprctl", args, { timeout: 5000 }, (_err, out) => resolve(String(out ?? ""))));
}

/** ~/.config/hypr/ai-pulse-dock.lua — generated; required by ai-pulse.lua via pcall. */
export function dockRuleFile(): string {
  return path.join(xdgConfigHome(), "hypr", "ai-pulse-dock.lua");
}

const DOCK_FILE_HEADER = "-- Generated by AI Pulse (packages/widget/src/platform.ts). Do not edit: rewritten on show/hide.\n";

async function defaultGaps(): Promise<[number, number, number, number]> {
  // {"option":"general:gaps_out","css":"10 10 10 10",...}
  try {
    const parsed = JSON.parse(await hyprctlText(["-j", "getoption", "general:gaps_out"])) as { css?: string };
    const parts = (parsed.css ?? "").trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) return [parts[0], parts[1], parts[2], parts[3]];
    if (parts.length === 1 && Number.isFinite(parts[0])) return [parts[0], parts[0], parts[0], parts[0]];
  } catch {
    /* fall through */
  }
  return [10, 10, 10, 10];
}

/** Write the dock rule file only when its content changes, then reload Hyprland's config. */
async function writeDockFile(content: string): Promise<void> {
  const file = dockRuleFile();
  let current = "";
  try {
    current = fs.readFileSync(file, "utf8");
  } catch {
    /* absent */
  }
  if (current === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  // config-only: re-evaluates the Lua config (what Omarchy does on theme change)
  // without re-initialising monitors; workspace gaps re-layout immediately.
  await hyprctlText(["reload", "config-only"]);
}

export interface DockRules {
  /** Leaderboard window is on screen (only then can it claim space). */
  active: boolean;
  /** Monitor to keep the leaderboard on; empty = follow the focused one. */
  monitor: string;
  side: "left" | "right";
  width: number;
  gap: number;
  /** Keep tiled windows clear of the leaderboard (workspace gaps). */
  reserveSpace: boolean;
}

/**
 * Write the generated Hyprland rules for the leaderboard: which monitor it
 * opens on, and — when asked — extra `gaps_out` so tiled windows keep clear of
 * it. A monitor-level `reserved` area would shrink Omarchy's layer-shell bar,
 * hence per-workspace gaps. The rules live in a file that ai-pulse.lua requires,
 * so they survive Hyprland reloads (theme changes) and, unlike `hyprctl eval`
 * state, a `reload config-only`. No-op outside Hyprland; failures are silent.
 */
export async function hyprlandRules(rules: DockRules): Promise<void> {
  if (!isHyprland) return;
  const lines: string[] = [];

  if (rules.monitor) {
    // Static rule, evaluated when the window maps: the only reliable way to put
    // a window on another output (moving it by pixels paints it there but
    // leaves it owned by the original monitor's workspace).
    lines.push(`-- Leaderboard opens on ${rules.monitor}.`);
    lines.push(
      `o.window({ class = "^${DESKTOP_ID}$", title = "^${LEADERBOARD_TITLE}$" }, { monitor = ${JSON.stringify(rules.monitor)} })`,
    );
  }

  if (rules.active && rules.reserveSpace) {
    const monitor = rules.monitor || (await currentLeaderboardMonitor());
    if (monitor) {
      const [top, right, bottom, left] = await defaultGaps();
      const r = rules.side === "right" ? right + rules.width + rules.gap : right;
      const l = rules.side === "left" ? left + rules.width + rules.gap : left;
      lines.push(`-- Tiled windows on ${monitor} keep clear of the ${rules.width}px leaderboard strip.`);
      // One monitor selector covers every workspace on it, including ones
      // created later (verified on Hyprland 0.56: `workspace = "m[DP-3]"`).
      lines.push(
        `hl.workspace_rule({ workspace = "m[${monitor}]", gaps_out = { top = ${top}, right = ${r}, bottom = ${bottom}, left = ${l} } })`,
      );
    }
  }

  await writeDockFile(`${DOCK_FILE_HEADER}${lines.length ? lines.join("\n") : "-- No leaderboard rules."}\n`);
}

/** Name of the monitor the leaderboard window currently sits on, if any. */
async function currentLeaderboardMonitor(): Promise<string> {
  const clients = await hyprctlJson<HyprClient[]>(["clients"]);
  const win = clients?.find((c) => c.class === DESKTOP_ID && c.title === LEADERBOARD_TITLE);
  if (!win) return "";
  const monitors = await hyprctlJson<HyprMonitorFull[]>(["monitors"]);
  return monitors?.find((m) => m.id === win.monitor)?.name ?? "";
}

/** The Omarchy integration installer: shipped under resources/linux when packaged. */
export function omarchyInstallerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "linux", "linux-install.mjs")
    : path.join(__dirname, "..", "..", "scripts", "linux-install.mjs"); // dist/src -> packages/widget/scripts
}

/** Run the installer (or --uninstall) with the bundled runtime; resolves to its combined output. */
export function runOmarchyInstaller(uninstall = false): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const script = omarchyInstallerPath();
    if (!isLinux || !fs.existsSync(script)) {
      resolve({ ok: false, output: `installer not found: ${script}` });
      return;
    }
    execFile(
      process.execPath,
      [script, ...(uninstall ? ["--uninstall"] : [])],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout}${stderr}`.trim() }),
    );
  });
}
