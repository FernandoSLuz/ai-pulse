import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoItem } from "../types.js";

const FEED_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;

const parser = new Parser({
  customFields: {
    item: [["media:group", "mediaGroup", { keepArray: false }]],
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface YtChannel {
  name: string;
  handle: string;
  channelId: string;
}

interface SourcesConfig {
  youtubeChannels: YtChannel[];
}

function loadChannels(): YtChannel[] {
  const base = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..", "..");
  const configPath = path.join(base, "config", "sources.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as SourcesConfig;
    return raw.youtubeChannels ?? [];
  } catch (err) {
    console.warn("[YouTube] Failed to load sources.json:", (err as Error).message);
    return [];
  }
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

async function fetchChannelFeed(ch: YtChannel): Promise<VideoItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: {
      "User-Agent": "AI-Pulse/1.0 (+https://localhost; RSS reader)",
      Accept: "application/atom+xml, application/xml, text/xml, */*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  const parsed = await parser.parseString(xml);
  const items: VideoItem[] = [];

  for (const entry of parsed.items.slice(0, 8)) {
    const videoId = extractVideoId(entry);
    if (!videoId) continue;
    const title = (entry.title ?? "Untitled").trim();
    items.push({
      id: videoId,
      title,
      link: entry.link ?? `https://www.youtube.com/watch?v=${videoId}`,
      channel: ch.name,
      channelHandle: ch.handle,
      publishedAt: entry.isoDate ?? entry.pubDate ?? new Date().toISOString(),
      thumbnail: extractThumbnail(entry as Parser.Item & { mediaGroup?: unknown }),
      fetchedAt: new Date().toISOString(),
    });
  }

  return items;
}

export async function fetchCreatorVideos(): Promise<VideoItem[]> {
  const channels = loadChannels();
  const items: VideoItem[] = [];
  let ok = 0;
  let failed = 0;

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
          return [] as VideoItem[];
        }
      }),
    );
    for (const batchItems of results) items.push(...batchItems);
  }

  console.log(`[YouTube] Completed with ${ok} ok, ${failed} failed (${items.length} videos)`);

  return items.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}
