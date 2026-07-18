import fs from "node:fs";
import { configPath, dataDir } from "./paths";

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

export interface LeaderboardConfig {
  show: boolean;
  dockSide: "left" | "right";
  pinOnTop: boolean;
  rows: number;
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
  leaderboard: { show: true, dockSide: "right", pinOnTop: false, rows: 25 },
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
      show: lb.show ?? DEFAULT_CONFIG.leaderboard.show,
      dockSide: lb.dockSide === "left" ? "left" : "right",
      pinOnTop: Boolean(lb.pinOnTop),
      rows: Math.min(Math.max(Number(lb.rows) || DEFAULT_CONFIG.leaderboard.rows, 5), 40),
    },
  };
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return coerce(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG, keys: {} };
  }
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

/** Build the environment for the server child from config + inherited env. */
export function serverEnv(config: AppConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    AI_PULSE_DATA_DIR: dataDir(),
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
