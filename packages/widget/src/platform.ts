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
      "Categories=Utility;Network;",
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
