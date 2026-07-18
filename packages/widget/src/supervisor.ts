import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { serverEntry, serverLogPath, logDir } from "./paths";
import { loadConfig, serverEnv } from "./config";

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  healthy: boolean;
  restarts: number;
  lastHealthyAt: string | null;
  lastExitCode: number | null;
  userStopped: boolean;
  port: number;
}

const HEALTH_INTERVAL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_FAILS_BEFORE_KILL = 3; // ~1 min unresponsive => assume hang, restart
const MAX_BACKOFF_MS = 30_000;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * Owns the background server process and keeps it alive. Restarts on crash
 * (with exponential backoff) and on hang (detected by failing health pings),
 * unless the user explicitly stopped it from the tray/settings.
 */
export class ServerSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private userStopped = false;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private consecutiveHealthFails = 0;
  private healthy = false;
  private lastHealthyAt: number | null = null;
  private lastExitCode: number | null = null;
  private port = 3847;

  start(): void {
    this.userStopped = false;
    if (this.child) return;
    this.spawnChild();
    this.startHealthMonitor();
  }

  /** User-initiated stop — do not auto-restart until start() is called again. */
  stop(): void {
    this.userStopped = true;
    this.clearRestartTimer();
    this.killChild();
    this.emitStatus();
  }

  restart(): void {
    this.userStopped = false;
    this.clearRestartTimer();
    if (this.child) {
      this.killChild(); // exit handler will respawn
    } else {
      this.start();
    }
  }

  /** Full shutdown for app quit. */
  async shutdown(): Promise<void> {
    this.userStopped = true;
    this.clearRestartTimer();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      this.killChild();
      setTimeout(done, 4000); // don't hang app quit
    });
  }

  getStatus(): ServerStatus {
    return {
      running: this.child !== null,
      pid: this.child?.pid ?? null,
      healthy: this.healthy,
      restarts: this.restarts,
      lastHealthyAt: this.lastHealthyAt ? new Date(this.lastHealthyAt).toISOString() : null,
      lastExitCode: this.lastExitCode,
      userStopped: this.userStopped,
      port: this.port,
    };
  }

  // --- internals ------------------------------------------------------------

  private spawnChild(): void {
    const config = loadConfig();
    this.port = config.port;
    fs.mkdirSync(logDir(), { recursive: true });
    this.rotateLogIfLarge();
    const out = fs.openSync(serverLogPath(), "a");

    const child = spawn(process.execPath, [serverEntry()], {
      env: serverEnv(config),
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    this.child = child;
    this.healthy = false;

    // Both 'exit' and 'error' (which can fire without a following 'exit' on a
    // spawn failure, and sometimes both fire) route through one idempotent
    // handler so we always close the log fd and schedule exactly one restart.
    let handled = false;
    const onGone = (code: number | null) => {
      if (handled) return;
      handled = true;
      this.lastExitCode = code;
      this.child = null;
      this.healthy = false;
      this.consecutiveHealthFails = 0;
      try {
        fs.closeSync(out);
      } catch {
        /* already closed */
      }
      this.emitStatus();
      if (!this.userStopped) {
        this.restarts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.restarts, 5));
        console.warn(`[Supervisor] Server gone (code ${code}). Restart #${this.restarts} in ${delay}ms.`);
        this.scheduleRestart(delay);
      }
    };

    child.on("exit", (code) => onGone(code));
    child.on("error", (err) => {
      console.error("[Supervisor] Server process error:", err.message);
      onGone(null);
    });

    this.emitStatus();
  }

  private scheduleRestart(delayMs: number): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.userStopped && !this.child) this.spawnChild();
    }, delayMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private killChild(): void {
    const child = this.child;
    if (!child) return;
    try {
      child.kill(); // Windows: TerminateProcess (immediate); POSIX: SIGTERM
      setTimeout(() => {
        // If the exit handler still hasn't nulled this.child, the process
        // ignored SIGTERM — force-kill it. (child.killed only reflects that a
        // signal was sent, not that the process died, so it can't gate this.)
        if (this.child === child) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
        }
      }, 5000);
    } catch {
      /* already gone */
    }
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => void this.checkHealth(), HEALTH_INTERVAL_MS);
  }

  private async checkHealth(): Promise<void> {
    if (!this.child || this.userStopped) return;
    const ok = await this.pingHealth();
    if (ok) {
      this.healthy = true;
      this.lastHealthyAt = Date.now();
      this.consecutiveHealthFails = 0;
      this.restarts = 0; // recovered — reset backoff
    } else {
      this.healthy = false;
      this.consecutiveHealthFails += 1;
      if (this.consecutiveHealthFails >= HEALTH_FAILS_BEFORE_KILL) {
        console.warn(
          `[Supervisor] Server unresponsive (${this.consecutiveHealthFails} failed health checks) — restarting.`,
        );
        this.consecutiveHealthFails = 0;
        this.killChild(); // exit handler respawns
      }
    }
    this.emitStatus();
  }

  private async pingHealth(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/api/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private rotateLogIfLarge(): void {
    try {
      const stat = fs.statSync(serverLogPath());
      if (stat.size > LOG_ROTATE_BYTES) {
        fs.rmSync(`${serverLogPath()}.old`, { force: true });
        fs.renameSync(serverLogPath(), `${serverLogPath()}.old`);
      }
    } catch {
      /* no log yet */
    }
  }

  private emitStatus(): void {
    this.emit("status", this.getStatus());
  }
}
