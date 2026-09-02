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

/** Desktop Entry spec quoting for one Exec argument. */
function quoteExecArg(arg: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
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
export async function hyprlandDock(title: string, width: number, side: "left" | "right", gap: number): Promise<void> {
  if (!isHyprland) return;
  const clients = await hyprctlJson<HyprClient[]>(["clients"]);
  const win = clients?.find((c) => c.class === DESKTOP_ID && c.title === title);
  if (!win) return;
  const monitors = await hyprctlJson<HyprMonitor[]>(["monitors"]);
  const mon = monitors?.find((m) => m.id === win.monitor) ?? monitors?.[0];
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

interface HyprMonitorFull extends HyprMonitor {
  name: string;
}

function hyprEval(lua: string): Promise<string> {
  return new Promise((resolve) => execFile("hyprctl", ["eval", lua], { timeout: 3000 }, (_err, out) => resolve(String(out ?? ""))));
}

function reservedLua(output: string, left: number, right: number): string {
  // `reserved` only touches the config-level reservation; layer-shell zones
  // (the bar) are tracked separately by Hyprland and stay intact.
  return `hl.monitor({ output = ${JSON.stringify(output)}, reserved = { top = 0, bottom = 0, left = ${left}, right = ${right} } })`;
}

/**
 * Turn the docked leaderboard into a real side dock: reserve its width on
 * the monitor it sits on so tiled windows never end up underneath it.
 * Any previous reservation of ours on other monitors is released first
 * (the window may have moved). Hyprland >= 0.55 only (Lua eval).
 */
export async function hyprlandReserve(title: string, width: number, side: "left" | "right"): Promise<void> {
  if (!isHyprland) return;
  const clients = await hyprctlJson<HyprClient[]>(["clients"]);
  const win = clients?.find((c) => c.class === DESKTOP_ID && c.title === title);
  const monitors = await hyprctlJson<HyprMonitorFull[]>(["monitors"]);
  if (!win || !monitors) return;
  const target = monitors.find((m) => m.id === win.monitor);
  for (const m of monitors) {
    const [l, , r] = m.reserved ?? [0, 0, 0, 0];
    const mine = m === target;
    const wantLeft = mine && side === "left" ? width : 0;
    const wantRight = mine && side === "right" ? width : 0;
    const ours = l === width || r === width; // only ever release what we reserved
    if ((mine && (l !== wantLeft || r !== wantRight)) || (!mine && ours)) {
      await hyprEval(reservedLua(m.name, wantLeft, wantRight));
    }
  }
}

/** Release every reservation of `width` px we hold (leaderboard hidden or app quitting). */
export async function hyprlandRelease(width: number): Promise<void> {
  if (!isHyprland) return;
  const monitors = await hyprctlJson<HyprMonitorFull[]>(["monitors"]);
  for (const m of monitors ?? []) {
    const [l, , r] = m.reserved ?? [0, 0, 0, 0];
    if (l === width || r === width) await hyprEval(reservedLua(m.name, 0, 0));
  }
}
