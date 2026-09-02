import { app } from "electron";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { configPath, dataDir, serverBundleDir, legacyConfigPaths } from "./paths";

/**
 * User configuration, stored in userData/config.json. This is the single source
 * of truth for API keys and preferences in the packaged app — there is no .env.
 * The keys map is merged into the server child's environment on launch.
 */

export type LlmKeyName =
  | "GEMINI_API_KEY"
  | "CEREBRAS_API_KEY"
  | "GROQ_API_KEY"
  | "OPENROUTER_API_KEY"
  | "AA_API_KEY"
  | "TAVILY_API_KEY";

export const LLM_KEY_NAMES: LlmKeyName[] = [
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "AA_API_KEY",
  "TAVILY_API_KEY",
];

export type LeaderboardMode = "bar" | "window";

export interface LeaderboardConfig {
  /** "bar": the omarchy-shell panel (Linux default) — no floating window. "window": the Electron widget. */
  mode: LeaderboardMode;
  show: boolean;
  dockSide: "left" | "right";
  pinOnTop: boolean;
  rows: number;
  /** Linux/Hyprland, window mode only: add workspace gaps so tiled windows stay clear of the widget. */
  reserveSpace: boolean;
}

export interface AppConfig {
  keys: Partial<Record<LlmKeyName, string>>;
  port: number;
  autoLaunch: boolean;
  startHidden: boolean;
  leaderboard: LeaderboardConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  keys: {},
  port: 3847,
  autoLaunch: true,
  startHidden: true,
  leaderboard: {
    mode: process.platform === "linux" ? "bar" : "window",
    show: true,
    dockSide: "right",
    pinOnTop: false,
    rows: 25,
    reserveSpace: false,
  },
};

function coerce(raw: unknown): AppConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<AppConfig>;
  const keys: Partial<Record<LlmKeyName, string>> = {};
  const rawKeys = (obj.keys ?? {}) as Record<string, unknown>;
  for (const name of LLM_KEY_NAMES) {
    const v = rawKeys[name];
    if (typeof v === "string" && v.trim()) keys[name] = v.trim();
  }
  const lb = (obj.leaderboard ?? {}) as Partial<LeaderboardConfig>;
  return {
    keys,
    port: Number(obj.port) || DEFAULT_CONFIG.port,
    autoLaunch: obj.autoLaunch ?? DEFAULT_CONFIG.autoLaunch,
    startHidden: obj.startHidden ?? DEFAULT_CONFIG.startHidden,
    leaderboard: {
      mode: lb.mode === "bar" || lb.mode === "window" ? lb.mode : DEFAULT_CONFIG.leaderboard.mode,
      show: lb.show ?? DEFAULT_CONFIG.leaderboard.show,
      dockSide: lb.dockSide === "left" ? "left" : "right",
      pinOnTop: Boolean(lb.pinOnTop),
      rows: Math.min(Math.max(Number(lb.rows) || DEFAULT_CONFIG.leaderboard.rows, 5), 40),
      reserveSpace: Boolean(lb.reserveSpace),
    },
  };
}

export function loadConfig(): AppConfig {
  const file = configPath();

  // One-time migration: if this version has no config yet, adopt the most recent
  // previous version's config so updates never lose saved API keys.
  if (!fs.existsSync(file)) {
    for (const legacy of legacyConfigPaths()) {
      if (legacy !== file && fs.existsSync(legacy)) {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.copyFileSync(legacy, file);
          console.log(`[Config] Migrated settings from ${legacy}`);
        } catch {
          /* fall through to defaults */
        }
        break;
      }
    }
  }

  // Read the config, falling back to the last-good backup if it's missing/corrupt.
  for (const candidate of [file, `${file}.bak`]) {
    try {
      return coerce(JSON.parse(fs.readFileSync(candidate, "utf8")));
    } catch {
      /* try the next candidate */
    }
  }

  // First run from a source checkout: adopt the developer .env so the app is
  // useful immediately. Packaged builds never look at a .env.
  const seeded = seedKeysFromDotenv();
  const fresh: AppConfig = { ...DEFAULT_CONFIG, keys: seeded };
  if (Object.keys(seeded).length > 0) {
    try {
      saveConfig(fresh);
    } catch (err) {
      console.warn("[Config] Could not persist seeded keys:", (err as Error).message);
    }
  }
  return fresh;
}

/** Keys from the repo-root .env (dev only); empty when packaged or absent. */
function seedKeysFromDotenv(): Partial<Record<LlmKeyName, string>> {
  if (app.isPackaged) return {};
  const candidates = [
    process.env.AI_PULSE_ENV_FILE,
    path.resolve(__dirname, "..", "..", "..", "..", ".env"), // dist/src -> packages/widget -> packages -> repo
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = dotenv.parse(fs.readFileSync(candidate, "utf8"));
      const keys: Partial<Record<LlmKeyName, string>> = {};
      for (const name of LLM_KEY_NAMES) {
        const value = parsed[name]?.trim();
        if (value) keys[name] = value;
      }
      console.log(`[Config] Seeded ${Object.keys(keys).length} key(s) from ${candidate}`);
      return keys;
    } catch (err) {
      console.warn(`[Config] Could not read ${candidate}:`, (err as Error).message);
    }
  }
  return {};
}

/** Atomic write with a rolling backup so a crash mid-save can't lose keys. */
export function saveConfig(config: AppConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(config, null, 2);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch {
    /* backup is best-effort */
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Fallback if atomic rename over an existing file isn't available.
    fs.writeFileSync(file, data, "utf8");
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Build the environment for the server child from config + inherited env. */
export function serverEnv(config: AppConfig): NodeJS.ProcessEnv {
  const bundleDir = serverBundleDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    AI_PULSE_DATA_DIR: dataDir(),
    AI_PULSE_RESOURCE_DIR: bundleDir,
    AI_PULSE_WEB_DIR: path.join(bundleDir, "web"),
    AI_PULSE_VERSION: app.getVersion(),
    PORT: String(config.port),
  };
  // config.json keys win over any inherited env so the app's Settings are authoritative.
  for (const [name, value] of Object.entries(config.keys)) {
    if (value) env[name] = value;
  }
  return env;
}

/** Redact secrets for sending config to the renderer (never expose raw keys). */
export function redactedKeys(config: AppConfig): Record<LlmKeyName, boolean> {
  const out = {} as Record<LlmKeyName, boolean>;
  for (const name of LLM_KEY_NAMES) out[name] = Boolean(config.keys[name]);
  return out;
}
