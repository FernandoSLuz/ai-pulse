import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

/**
 * Checks GitHub Releases for a newer version and lets the user opt in to
 * updating. Nothing downloads or installs without an explicit user action:
 * autoDownload is off, and the Settings window drives download/install.
 *
 * Everything electron-updater does is logged to userData/logs/updater.log so
 * failed updates are diagnosable, and differential (blockmap) downloads are
 * disabled — full downloads are far more reliable, especially for unsigned
 * apps and prereleases.
 */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"
  | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  percent: number;
  error: string | null;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const INITIAL_DELAY_MS = 12_000;

function createLogger() {
  let file: string | null = null;
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, "updater.log");
  } catch {
    file = null;
  }
  const write = (level: string, args: unknown[]) => {
    if (!file) return;
    try {
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${level} ${args.map((a) => String(a)).join(" ")}\n`);
    } catch {
      /* ignore log failures */
    }
  };
  return {
    info: (...a: unknown[]) => write("INFO", a),
    warn: (...a: unknown[]) => write("WARN", a),
    error: (...a: unknown[]) => write("ERROR", a),
    debug: (...a: unknown[]) => write("DEBUG", a),
    transports: {},
  };
}

export class Updater extends EventEmitter {
  state: UpdateState;
  private started = false;

  constructor() {
    super();
    this.state = {
      status: app.isPackaged ? "idle" : "unsupported",
      currentVersion: app.getVersion(),
      availableVersion: null,
      percent: 0,
      error: null,
    };
  }

  init(): void {
    if (this.started) return;
    this.started = true;
    // electron-updater only works in a packaged app; in dev it just throws.
    if (!app.isPackaged) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    autoUpdater.logger = createLogger() as any;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // Full downloads are much more reliable than blockmap differential downloads
    // (which silently fail for unsigned apps / prereleases / flaky range support).
    autoUpdater.disableDifferentialDownload = true;

    autoUpdater.on("checking-for-update", () => this.set({ status: "checking", error: null }));
    autoUpdater.on("update-available", (info) => {
      this.set({ status: "available", availableVersion: info.version });
      this.notify(`AI Pulse ${info.version} is available`, "Open AI Pulse → Settings to update.");
    });
    autoUpdater.on("update-not-available", () => this.set({ status: "not-available" }));
    autoUpdater.on("download-progress", (p) =>
      this.set({ status: "downloading", percent: Math.round(p.percent) }),
    );
    autoUpdater.on("update-downloaded", (info) => {
      this.set({ status: "downloaded", availableVersion: info.version });
      this.notify("AI Pulse update ready", "Open Settings and click Restart & install.");
    });
    autoUpdater.on("error", (err) => this.set({ status: "error", error: err == null ? "unknown error" : err.message }));

    setTimeout(() => this.check(), INITIAL_DELAY_MS);
    setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  check(): void {
    if (!app.isPackaged) return;
    this.set({ status: "checking", error: null });
    autoUpdater.checkForUpdates().catch((e) => this.set({ status: "error", error: (e as Error).message }));
  }

  download(): void {
    if (!app.isPackaged) return;
    this.set({ status: "downloading", percent: 0, error: null });
    autoUpdater.downloadUpdate().catch((e) => this.set({ status: "error", error: (e as Error).message }));
  }

  /** Quit and install the downloaded update — the only place that restarts. */
  install(): void {
    if (app.isPackaged && this.state.status === "downloaded") {
      try {
        autoUpdater.quitAndInstall();
      } catch (e) {
        this.set({ status: "error", error: (e as Error).message });
      }
    }
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    } catch {
      /* notifications unavailable */
    }
  }
}
