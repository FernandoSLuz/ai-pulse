import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { serverEntry, serverLogPath, logDir } from "./paths";
import { loadConfig, serverEnv } from "./config";

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  healthy: boolean;
  adopted: boolean;
  failed: boolean;
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
const MAX_NEVER_HEALTHY_RESTARTS = 10; // give up (and surface) if it never boots healthy
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * Owns the background server process and keeps it alive. Restarts on crash
 * (with exponential backoff) and on hang (detected by failing health pings),
 * unless the user explicitly stopped it. If a server is already listening on
 * our port (e.g. an orphan left by a previous ungraceful exit) it is adopted
 * rather than fought with, and a circuit breaker surfaces a "failed" state
 * instead of thrashing forever when the server can never boot healthy.
 */
export class ServerSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private adopted = false; // using a server already running on our port
  private spawning = false; // async spawn in flight (guards re-entrancy)
  private failed = false; // gave up after repeated failed boots
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
    this.failed = false;
    this.restarts = 0;
    this.startHealthMonitor();
    if (this.child || this.adopted || this.spawning) return;
    void this.spawnChild();
  }

  /** User-initiated stop — do not auto-restart until start() is called again. */
  stop(): void {
    this.userStopped = true;
    this.clearRestartTimer();
    this.adopted = false; // we hold no handle to an adopted process; just release it
    this.killChild();
    this.emitStatus();
  }

  restart(): void {
    this.userStopped = false;
    this.failed = false;
    this.clearRestartTimer();
    if (this.child) {
      this.killChild(); // exit handler respawns
    } else {
      this.adopted = false;
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
      running: this.child !== null || this.adopted,
      pid: this.child?.pid ?? null,
      healthy: this.healthy,
      adopted: this.adopted,
      failed: this.failed,
      restarts: this.restarts,
      lastHealthyAt: this.lastHealthyAt ? new Date(this.lastHealthyAt).toISOString() : null,
      lastExitCode: this.lastExitCode,
      userStopped: this.userStopped,
      port: this.port,
    };
  }

  // --- internals ------------------------------------------------------------

  private async spawnChild(): Promise<void> {
    if (this.spawning || this.child) return;
    this.spawning = true;
    try {
      const config = loadConfig();
      this.port = config.port;

      // If a server already answers on our port (most likely an orphan from a
      // previous ungraceful exit), adopt it instead of spawning a duplicate that
      // would collide on the port and restart-loop forever.
      if (await this.pingHealth()) {
        this.adopted = true;
        this.healthy = true;
        this.lastHealthyAt = Date.now();
        this.consecutiveHealthFails = 0;
        this.restarts = 0;
        console.warn(`[Supervisor] Adopted an existing healthy server on port ${this.port}.`);
        this.emitStatus();
        return;
      }
      this.adopted = false;

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
        if (this.userStopped) return;

        this.restarts += 1;
        // Circuit breaker: if the server has NEVER booted healthy across many
        // attempts (e.g. a persistent port collision we can't adopt, or a broken
        // build), stop looping and surface it instead of thrashing forever.
        if (this.lastHealthyAt === null && this.restarts >= MAX_NEVER_HEALTHY_RESTARTS) {
          this.failed = true;
          console.error(
            `[Supervisor] Server never started healthy after ${this.restarts} attempts — giving up. Use "Start" to retry.`,
          );
          this.emitStatus();
          return;
        }
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.restarts, 5));
        console.warn(`[Supervisor] Server gone (code ${code}). Restart #${this.restarts} in ${delay}ms.`);
        this.scheduleRestart(delay);
      };

      child.on("exit", (code) => onGone(code));
      child.on("error", (err) => {
        console.error("[Supervisor] Server process error:", err.message);
        onGone(null);
      });

      this.emitStatus();
    } finally {
      this.spawning = false;
    }
  }

  private scheduleRestart(delayMs: number): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.userStopped && !this.child && !this.adopted) void this.spawnChild();
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
    if ((!this.child && !this.adopted) || this.userStopped) return;
    const ok = await this.pingHealth();
    if (ok) {
      this.healthy = true;
      this.lastHealthyAt = Date.now();
      this.consecutiveHealthFails = 0;
      this.restarts = 0; // recovered — reset backoff
      this.failed = false;
    } else {
      this.healthy = false;
      this.consecutiveHealthFails += 1;
      if (this.consecutiveHealthFails >= HEALTH_FAILS_BEFORE_KILL) {
        this.consecutiveHealthFails = 0;
        if (this.adopted) {
          // The adopted server stopped responding — take over by spawning ours.
          console.warn("[Supervisor] Adopted server stopped responding — starting our own.");
          this.adopted = false;
          void this.spawnChild();
        } else {
          console.warn("[Supervisor] Server unresponsive — restarting.");
          this.killChild(); // exit handler respawns
        }
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
