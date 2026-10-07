/**
 * X/Twitter integration.
 *
 * X does not expose public timelines without an authenticated API project.
 * This module therefore has two explicit modes:
 *  - configured: X_API_BEARER_TOKEN enables the official v2 API;
 *  - links: profile cards remain useful without credentials and never claim
 *    to contain posts.
 *
 * Keep persistence and HTTP routing in index/db. The functions here are
 * deliberately side-effect free apart from network requests so a failed X
 * poll cannot affect news, benchmarks, or videos.
 */

const X_API_ROOT = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 12_000;

export interface XProfile {
  handle: string;
  name: string;
  description?: string;
  userId?: string;
  profileUrl: string;
  source: "default" | "user";
}

export interface XPost {
  id: string;
  text: string;
  createdAt: string;
  authorHandle: string;
  authorName: string;
  url: string;
  source: "x-api";
}

export interface XFeedResult {
  mode: "api" | "links";
  items: XPost[];
  profiles: XProfile[];
  fetchedAt: string;
  error: string | null;
}

export const DEFAULT_X_PROFILES: readonly XProfile[] = [
  { handle: "sama", name: "Sam Altman", profileUrl: "https://x.com/sama", source: "default" },
  { handle: "elonmusk", name: "Elon Musk", profileUrl: "https://x.com/elonmusk", source: "default" },
  { handle: "ylecun", name: "Yann LeCun", profileUrl: "https://x.com/ylecun", source: "default" },
  { handle: "demishassabis", name: "Demis Hassabis", profileUrl: "https://x.com/demishassabis", source: "default" },
  { handle: "AnthropicAI", name: "Anthropic", profileUrl: "https://x.com/AnthropicAI", source: "default" },
  { handle: "OpenAI", name: "OpenAI", profileUrl: "https://x.com/OpenAI", source: "default" },
  { handle: "GoogleDeepMind", name: "Google DeepMind", profileUrl: "https://x.com/GoogleDeepMind", source: "default" },
];

function bearerToken(): string | undefined {
  const value = process.env.X_API_BEARER_TOKEN?.trim();
  return value || undefined;
}

function uniqueProfiles(profiles: XProfile[]): XProfile[] {
  const seen = new Set<string>();
  return profiles.filter((p) => {
    const handle = p.handle.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle) || seen.has(handle)) return false;
    seen.add(handle);
    return true;
  });
}

async function xFetch(path: string, params: URLSearchParams): Promise<unknown> {
  const token = bearerToken();
  if (!token) throw new Error("X API is not configured (set X_API_BEARER_TOKEN)");
  const response = await fetch(`${X_API_ROOT}${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Do not expose provider response bodies: they may contain request IDs or
    // account metadata. The status is enough for the user-facing health state.
    try { await response.body?.cancel(); } catch { /* ignore */ }
    throw new Error(`X API request failed (HTTP ${response.status})`);
  }
  return response.json();
}

export async function resolveXProfiles(profiles: XProfile[]): Promise<XProfile[]> {
  const selected = uniqueProfiles(profiles);
  if (!bearerToken() || selected.length === 0) return selected;
  const params = new URLSearchParams({
    usernames: selected.map((p) => p.handle).join(","),
    "user.fields": "description,name,username",
  });
  const body = (await xFetch("/users/by", params)) as { data?: Array<{ id: string; name: string; username: string; description?: string }> };
  const byHandle = new Map((body.data ?? []).map((u) => [u.username.toLowerCase(), u]));
  return selected.map((p) => {
    const user = byHandle.get(p.handle.toLowerCase());
    return user
      ? { ...p, handle: user.username, name: user.name, description: user.description, userId: user.id, source: p.source }
      : p;
  });
}

export async function fetchXFeed(profiles: XProfile[], maxPostsPerProfile = 10): Promise<XFeedResult> {
  const fetchedAt = new Date().toISOString();
  const selected = uniqueProfiles(profiles);
  if (!bearerToken()) {
    return { mode: "links", items: [], profiles: selected, fetchedAt, error: "X API is not configured; showing profile links only" };
  }

  try {
    const resolved = await resolveXProfiles(selected);
    const items: XPost[] = [];
    const failures: string[] = [];
    for (const profile of resolved) {
      if (!profile.userId) {
        failures.push(`${profile.handle}: profile was not found by X`);
        continue;
      }
      try {
        const params = new URLSearchParams({ max_results: String(Math.min(100, Math.max(5, maxPostsPerProfile))), exclude: "retweets,replies", "tweet.fields": "created_at" });
        const body = (await xFetch(`/users/${encodeURIComponent(profile.userId)}/tweets`, params)) as { data?: Array<{ id: string; text: string; created_at?: string }> };
        for (const post of body.data ?? []) {
          // X normally returns created_at when requested. Never invent a
          // timestamp: a post without one is not safe to cache or sort.
          if (!post.created_at) continue;
          const createdAt = post.created_at;
          items.push({ id: post.id, text: post.text, createdAt, authorHandle: profile.handle, authorName: profile.name, url: `https://x.com/${profile.handle}/status/${post.id}`, source: "x-api" });
        }
      } catch (err) {
        failures.push(`${profile.handle}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { mode: "api", items, profiles: resolved, fetchedAt, error: failures.length ? failures.join("; ") : null };
  } catch (err) {
    return {
      mode: "api",
      items: [],
      profiles: selected,
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
