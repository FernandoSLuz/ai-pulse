import type { Express, Request, Response } from "express";
import {
  deleteSocialProfile, getSocialPosts, getSocialProfiles, replaceSocialPosts, upsertSocialProfiles,
} from "../db.js";
import { getMeta, setMeta } from "../db.js";
import { DEFAULT_X_PROFILES, fetchXFeed, type XProfile } from "./x.js";
import type { SocialProfile } from "../types.js";

const MAX_PROFILES = 30;
const REFRESH_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 30 * 60_000;
let timer: NodeJS.Timeout | undefined;
let refreshPromise: Promise<SocialState> | undefined;
let lastAttemptAt: string | null = null;
let updatedAt: string | null = null;
let lastError: string | null = null;
let lastRefreshMs = 0;
let lastMode: "api" | "links" = process.env.X_API_BEARER_TOKEN?.trim() ? "api" : "links";

const SOCIAL_ATTEMPT_KEY = "social_last_attempt_at";
const SOCIAL_UPDATED_KEY = "social_updated_at";

export interface SocialState {
  items: ReturnType<typeof getSocialPosts>;
  profiles: SocialProfile[];
  mode: "api" | "links";
  updatedAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  configured: boolean;
}

function normalizeHandle(value: unknown): string | null {
  const handle = String(value ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function profileFromInput(handle: string, name?: string): SocialProfile {
  const safeName = typeof name === "string" ? name.trim() : "";
  return { handle, name: safeName || `@${handle}`, profileUrl: `https://x.com/${handle}`, source: "user", enabled: true };
}

function ensureDefaults(): SocialProfile[] {
  const existingAll = getSocialProfiles(true);
  if (existingAll.length) return existingAll.filter((p) => p.enabled);
  const defaults = DEFAULT_X_PROFILES.map((p) => ({ ...p, enabled: true }));
  upsertSocialProfiles(defaults);
  return defaults;
}

function state(): SocialState {
  return { items: getSocialPosts(), profiles: ensureDefaults(), mode: lastMode, updatedAt: updatedAt ?? getMeta(SOCIAL_UPDATED_KEY), lastAttemptAt: lastAttemptAt ?? getMeta(SOCIAL_ATTEMPT_KEY), error: lastError, configured: Boolean(process.env.X_API_BEARER_TOKEN?.trim()) };
}

export async function refreshSocial(_force = false): Promise<SocialState> {
  const now = Date.now();
  if (now - lastRefreshMs < REFRESH_COOLDOWN_MS) return state();
  if (refreshPromise) return refreshPromise;
  lastRefreshMs = now;
  lastAttemptAt = new Date(now).toISOString();
  setMeta(SOCIAL_ATTEMPT_KEY, lastAttemptAt);
  refreshPromise = (async () => {
    const profiles = ensureDefaults();
    const result = await fetchXFeed(profiles as XProfile[]);
    if (result.profiles.length) {
      // A profile can be removed while the network request is in flight.
      // Only persist metadata for profiles that are still enabled now.
      const current = new Map(getSocialProfiles().map((p) => [p.handle.toLowerCase(), p]));
      upsertSocialProfiles(result.profiles.filter((p) => current.has(p.handle.toLowerCase())).map((p) => ({ ...p, enabled: true })));
    }
    lastMode = result.mode;
    if (result.items.length) replaceSocialPosts(result.items.map((p) => ({ ...p })));
    if (!result.error) {
      updatedAt = result.fetchedAt;
      setMeta(SOCIAL_UPDATED_KEY, updatedAt);
    }
    // An empty API response is valid, but a failed request must not erase cache
    // or advance updatedAt. The error remains visible to the UI.
    lastError = result.error;
    return state();
  })().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export function registerSocialRoutes(app: Express): void {
  app.get("/api/social", (_req, res) => res.json(state()));
  app.post("/api/social/profiles", async (req: Request, res: Response) => {
    const handle = normalizeHandle(req.body?.handle);
    if (!handle) return res.status(400).json({ error: "Invalid X handle" });
    const current = ensureDefaults();
    if (current.length >= MAX_PROFILES && !current.some((p) => p.handle.toLowerCase() === handle.toLowerCase())) return res.status(400).json({ error: `You can follow up to ${MAX_PROFILES} profiles` });
    if (!current.some((p) => p.handle.toLowerCase() === handle.toLowerCase())) upsertSocialProfiles([...current, profileFromInput(handle, req.body?.name)]);
    return res.status(201).json(state());
  });
  app.delete("/api/social/profiles/:handle", (req, res) => {
    const handle = normalizeHandle(req.params.handle);
    if (!handle) return res.status(400).json({ error: "Invalid X handle" });
    if (!deleteSocialProfile(handle)) return res.status(404).json({ error: "Profile not found" });
    return res.json(state());
  });
  app.post("/api/social/refresh", async (_req, res) => {
    try { return res.json(await refreshSocial()); }
    catch (err) { return res.status(503).json({ ...state(), error: err instanceof Error ? err.message : String(err) }); }
  });
}

export function initializeSocialPolling(): void {
  ensureDefaults();
  void refreshSocial().catch((err) => { lastError = err instanceof Error ? err.message : String(err); });
  timer = setInterval(() => void refreshSocial().catch((err) => { lastError = err instanceof Error ? err.message : String(err); }), POLL_INTERVAL_MS);
  timer.unref?.();
}

export function stopSocialPolling(): void { if (timer) clearInterval(timer); timer = undefined; }
