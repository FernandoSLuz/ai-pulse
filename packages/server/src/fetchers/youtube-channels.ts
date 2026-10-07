import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoItem } from "../types.js";
import { getYouTubeUserChannels } from "../db.js";

const FEED_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;

export interface VideoFetchHealth {
  kind: "creator" | "company";
  attempted: number;
  succeeded: number;
  failed: number;
  items: number;
  partial: boolean;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  errors: string[];
}

const videoHealth: Record<"creator" | "company", VideoFetchHealth | null> = { creator: null, company: null };

export function getVideoFetchHealth(kind?: "creator" | "company"): VideoFetchHealth | VideoFetchHealth[] | null {
  if (kind) return videoHealth[kind];
  return [videoHealth.creator, videoHealth.company].filter((v): v is VideoFetchHealth => Boolean(v));
}

const parser = new Parser({
  customFields: {
    item: [["media:group", "mediaGroup", { keepArray: false }]],
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface YtChannel {
  name: string;
  handle: string;
  channelId: string;
  channelUrl?: string;
  source?: "default" | "user";
}

interface SourcesConfig {
  youtubeChannels: YtChannel[];
  companyChannels?: YtChannel[];
}

function loadSources(): SourcesConfig {
  const base = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..", "..");
  const configPath = path.join(base, "config", "sources.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as SourcesConfig;
  } catch (err) {
    console.warn("[YouTube] Failed to load sources.json:", (err as Error).message);
    return { youtubeChannels: [], companyChannels: [] };
  }
}

function defaultChannels(kind: "creator" | "company"): YtChannel[] {
  const sources = loadSources();
  return (kind === "company" ? sources.companyChannels ?? [] : sources.youtubeChannels ?? []).map((channel) => ({
    ...channel,
    channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
    source: "default" as const,
  }));
}

export function getConfiguredYouTubeChannels(kind: "creator" | "company"): YtChannel[] {
  const all = [...defaultChannels(kind), ...getYouTubeUserChannels(kind)];
  const seen = new Set<string>();
  return all.filter((channel) => {
    if (seen.has(channel.channelId)) return false;
    seen.add(channel.channelId);
    return true;
  });
}

function extractVideoId(entry: Parser.Item): string | null {
  const raw = entry as Parser.Item & { id?: string };
  const id = raw.id ?? entry.guid ?? "";
  const match =
    String(id).match(/video:([A-Za-z0-9_-]+)/) ||
    String(entry.link ?? "").match(/[?&]v=([A-Za-z0-9_-]+)/) ||
    String(entry.link ?? "").match(/youtu\.be\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function extractThumbnail(entry: Parser.Item & { mediaGroup?: unknown }): string {
  const link = entry.link ?? "";
  const vid = extractVideoId(entry);
  if (vid) return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  const media = entry.mediaGroup as { "media:thumbnail"?: { $?: { url?: string } } } | undefined;
  return media?.["media:thumbnail"]?.$?.url ?? link;
}

const FEED_ATTEMPTS = 4;
const FEED_RETRY_BASE_MS = 600;

/**
 * YouTube's feed endpoint answers 200/404/500 at random across Google's edge
 * nodes on a bad day (observed 2026-09-02: ~1 in 6 requests succeeded, same
 * URL, same client). Each attempt lands on a different edge via DNS
 * round-robin, so a few short retries recover most channels instead of
 * waiting a whole poll cycle.
 */
async function fetchFeedXml(url: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= FEED_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers: {
          "User-Agent": "AI-Pulse/1.0 (+https://localhost; RSS reader)",
          Accept: "application/atom+xml, application/xml, text/xml, */*",
        },
      });
      if (res.ok) return await readLimitedText(res, 5 * 1024 * 1024);
      lastError = new Error(`HTTP ${res.status}`);
      // 4xx other than 404/429 won't change on retry.
      if (res.status < 500 && res.status !== 404 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < FEED_ATTEMPTS) await new Promise((r) => setTimeout(r, FEED_RETRY_BASE_MS * attempt));
  }
  throw lastError ?? new Error("feed fetch failed");
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("The YouTube response is too large.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}

export function normalizeYouTubeChannelInput(input: string): { url: string; handle: string } {
  const raw = input.trim();
  if (!raw || raw.length > 300) throw new Error("Enter a YouTube channel URL, @handle, or channel ID.");
  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : /^(?:www\.)?youtube\.com\//i.test(raw)
      ? `https://${raw}`
      : `https://www.youtube.com/${raw.replace(/^@/, "@").replace(/^\/+/, "")}`;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error("That YouTube channel address is not valid."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Only official youtube.com channel pages are supported.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const marker = parts[0]?.toLowerCase();
  if (marker === "channel" && parts[1] && CHANNEL_ID.test(parts[1])) {
    return { url: `https://www.youtube.com/channel/${parts[1]}`, handle: "" };
  }
  if (marker === "@" || parsed.pathname.startsWith("/@")) {
    const handle = parsed.pathname.slice(2).split("/")[0].trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) throw new Error("That YouTube handle is not valid.");
    return { url: `https://www.youtube.com/@${handle}`, handle: `@${handle}` };
  }
  if ((marker === "c" || marker === "user") && parts[1] && /^[A-Za-z0-9._-]{1,100}$/.test(parts[1])) {
    return { url: `https://www.youtube.com/${marker}/${parts[1]}`, handle: `@${parts[1]}` };
  }
  if (CHANNEL_ID.test(raw)) return { url: `https://www.youtube.com/channel/${raw}`, handle: "" };
  if (/^[A-Za-z0-9._-]{1,100}$/.test(raw.replace(/^@/, ""))) {
    const handle = raw.replace(/^@/, "");
    return { url: `https://www.youtube.com/@${handle}`, handle: `@${handle}` };
  }
  throw new Error("Use a YouTube channel URL, @handle, or channel ID.");
}

async function fetchOfficialPage(url: string, redirects = 0, deadline = Date.now() + 30_000): Promise<string> {
  if (redirects > 3) throw new Error("YouTube returned too many redirects.");
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("YouTube channel lookup timed out.");
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(Math.min(FEED_TIMEOUT_MS, remaining)),
    headers: { "User-Agent": "AI-Pulse/1.0 (channel resolver)", Accept: "text/html,application/xhtml+xml" },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      await response.body?.cancel();
      throw new Error("YouTube returned an invalid redirect.");
    }
    const redirected = new URL(location, url);
    if (redirected.protocol !== "https:" || !YOUTUBE_HOSTS.has(redirected.hostname.toLowerCase())) {
      await response.body?.cancel();
      throw new Error("The channel redirected outside youtube.com.");
    }
    await response.body?.cancel();
    return fetchOfficialPage(redirected.toString(), redirects + 1, deadline);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`YouTube channel page returned HTTP ${response.status}.`);
  }
  return readLimitedText(response, 8 * 1024 * 1024);
}

function htmlMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta[^>]+(?:itemprop|property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:itemprop|property|name)=["']${escaped}["']`, "i");
  return (html.match(re)?.[1] ?? html.match(reverse)?.[1] ?? null)?.trim() || null;
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export interface ResolvedYouTubeChannel extends YtChannel {
  kind: "creator" | "company";
  channelUrl: string;
  source: "user";
  initialVideos: VideoItem[];
}

function parseFeedVideos(parsed: { items: Parser.Item[] }, ch: YtChannel, kind: "creator" | "company"): VideoItem[] {
  const items: VideoItem[] = [];
  for (const entry of parsed.items.slice(0, 8)) {
    const videoId = extractVideoId(entry);
    if (!videoId) continue;
    const title = (entry.title ?? "Untitled").trim();
    const publishedAt = entry.isoDate ?? entry.pubDate;
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;
    items.push({
      id: videoId,
      title,
      link: entry.link ?? `https://www.youtube.com/watch?v=${videoId}`,
      channel: ch.name,
      channelHandle: ch.handle || ch.channelId,
      publishedAt,
      thumbnail: extractThumbnail(entry as Parser.Item & { mediaGroup?: unknown }),
      fetchedAt: new Date().toISOString(),
      kind,
    });
  }
  return items;
}

export async function resolveYouTubeChannel(input: string, kind: "creator" | "company"): Promise<ResolvedYouTubeChannel> {
  const normalized = normalizeYouTubeChannelInput(input);
  const html = await fetchOfficialPage(normalized.url);
  const rendererId = html.match(/"channelMetadataRenderer"\s*:\s*\{[\s\S]{0,2000}?"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/i)?.[1];
  const channelId = rendererId ?? htmlMeta(html, "channelId");
  if (!channelId || !CHANNEL_ID.test(channelId)) throw new Error("Could not verify the channel ID from the official YouTube page.");
  const feedXml = await fetchFeedXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const parsed = await parser.parseString(feedXml);
  const recentCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const hasRecent = parsed.items.some((item) => {
    const published = item.isoDate ?? item.pubDate;
    return Boolean(published && Number.isFinite(Date.parse(published)) && Date.parse(published) >= recentCutoff && Date.parse(published) <= Date.now() + 5 * 60 * 1000);
  });
  if (!hasRecent) throw new Error("The channel RSS feed has no video from the last 90 days.");
  const title = parsed.title?.trim() || decodeHtml(htmlMeta(html, "og:title") ?? "").replace(/\s*[-|].*$/, "").trim() || channelId;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const channelUrl = canonical && /^https:\/\/(?:www\.)?youtube\.com\//i.test(canonical)
    ? canonical.split(/[?#]/)[0]
    : normalized.url;
  const handle = (channelUrl.match(/\/(@[^/?#]+)/)?.[1] ?? normalized.handle).trim();
  const channel = { channelId, name: title, handle, channelUrl, kind, source: "user" as const };
  return { ...channel, initialVideos: parseFeedVideos(parsed, channel, kind) };
}

export async function fetchChannelFeed(ch: YtChannel, kind: "creator" | "company" = "creator"): Promise<VideoItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
  const xml = await fetchFeedXml(url);
  const parsed = await parser.parseString(xml);
  return parseFeedVideos(parsed, ch, kind);
}

async function fetchChannelFeeds(channels: YtChannel[], kind: "creator" | "company"): Promise<VideoItem[]> {
  const items: VideoItem[] = [];
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  const attemptedAt = new Date().toISOString();

  for (let i = 0; i < channels.length; i += CONCURRENCY) {
    const batch = channels.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (ch) => {
        try {
          const videos = await fetchChannelFeed(ch);
          ok += 1;
          return videos;
        } catch (err) {
          failed += 1;
          const message = (err as Error).name === "TimeoutError"
            ? `timed out after ${FEED_TIMEOUT_MS}ms`
            : (err as Error).message;
          console.warn(`[YouTube] Failed ${ch.name}:`, message);
          errors.push(`${ch.name}: ${message}`);
          return [] as VideoItem[];
        }
      }),
    );
    for (const batchItems of results) items.push(...batchItems);
  }

  console.log(`[YouTube] Completed (${kind}) with ${ok} ok, ${failed} failed (${items.length} videos)`);
  const previous = videoHealth[kind];
  videoHealth[kind] = {
    kind, attempted: channels.length, succeeded: ok, failed, items: items.length,
    partial: failed > 0 && ok > 0, lastAttemptAt: attemptedAt,
    // Empty results after total failure must not look like a successful update.
    lastSuccessAt: ok > 0 ? attemptedAt : previous?.lastSuccessAt ?? null,
    errors,
  };

  const currentIds = new Set(getConfiguredYouTubeChannels(kind).map((channel) => channel.channelId));
  return items
    .filter((item) => {
      // A channel can be removed while a poll is in flight. Do not let that
      // late response resurrect its cached videos.
      const channel = channels.find((candidate) => item.channelHandle === candidate.handle || item.channelHandle === candidate.channelId);
      return channel ? currentIds.has(channel.channelId) : true;
    })
    .map((v) => ({ ...v, kind }))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export async function fetchCreatorVideos(): Promise<VideoItem[]> {
  return fetchChannelFeeds(getConfiguredYouTubeChannels("creator"), "creator");
}

export async function fetchCompanyVideos(): Promise<VideoItem[]> {
  return fetchChannelFeeds(getConfiguredYouTubeChannels("company"), "company");
}
