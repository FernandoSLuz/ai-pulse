import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 15_000;
const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const ALLOWED_EMPTY_FEED_CHANNEL_IDS = new Set([
  "UCxgo0OMZU9SiaYpJsuZKWkQ", // xAI / Grok @grok
  "UCyaKbYQdbCUiBSA_OT9mIvg", // Z.ai @Zai_org
  "UCRupI6LjjhbAJfwyHMNPX_g", // Mistral @mistral-ai
  "UCZzz69u3MGBmJ3APUTyyXPA", // DeepSeek @deepseek-ai
]);

const parser = new Parser();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FeedConfig {
  url: string;
  source: string;
  tier: number;
}

interface ChannelConfig {
  name: string;
  handle: string;
  channelId: string;
}

interface SourcesConfig {
  feeds?: FeedConfig[];
  youtubeChannels?: ChannelConfig[];
  companyChannels?: ChannelConfig[];
}

function loadSources(): SourcesConfig {
  const base = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..");
  const configPath = path.join(base, "config", "sources.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as SourcesConfig;
}

function formatError(err: unknown): string {
  const e = err as Error;
  if (e.name === "TimeoutError" || e.name === "AbortError") {
    return `timed out after ${TIMEOUT_MS}ms`;
  }
  return e.message ?? String(err);
}

async function fetchXml(url: string): Promise<{ status: number; xml: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "User-Agent": "AI-Pulse/1.0 (+https://localhost; RSS reader)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  const xml = res.ok ? await res.text() : "";
  return { status: res.status, xml };
}

let failures = 0;

function report(kind: string, name: string, ok: boolean, detail: string): void {
  const status = ok ? "OK   " : "FALHA";
  if (!ok) failures += 1;
  console.log(`[${status}] ${kind} | ${name} | ${detail}`);
}

async function checkFeed(feed: FeedConfig): Promise<void> {
  try {
    const { status, xml } = await fetchXml(feed.url);
    if (status !== 200) {
      report("FEED", feed.source, false, `HTTP ${status}`);
      return;
    }
    const parsed = await parser.parseString(xml);
    const now = Date.now();
    const recent = parsed.items.some((item) => {
      const raw = item.isoDate ?? item.pubDate;
      if (!raw) return false;
      const t = new Date(raw).getTime();
      return Number.isFinite(t) && now - t <= RECENCY_WINDOW_MS;
    });
    if (parsed.items.length === 0) {
      report("FEED", feed.source, false, `HTTP 200, mas 0 itens`);
    } else if (!recent) {
      report("FEED", feed.source, false, `HTTP 200, ${parsed.items.length} itens, nenhum nos últimos 90 dias`);
    } else {
      report("FEED", feed.source, true, `HTTP 200, ${parsed.items.length} itens, item recente nos últimos 90 dias`);
    }
  } catch (err) {
    report("FEED", feed.source, false, formatError(err));
  }
}

async function checkChannel(kind: string, ch: ChannelConfig): Promise<void> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
  try {
    // Same retry policy as fetchers/youtube-channels.ts: YouTube's edges answer
    // 200/404/500 at random on bad days, and each attempt hits another edge.
    let { status, xml } = await fetchXml(url);
    for (let attempt = 2; attempt <= 4 && (status === 404 || status === 429 || status >= 500); attempt++) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      ({ status, xml } = await fetchXml(url));
    }
    if (status !== 200) {
      report(kind, `${ch.name} (${ch.handle})`, false, `HTTP ${status}`);
      return;
    }
    const parsed = await parser.parseString(xml);
    if (parsed.items.length === 0 && !ALLOWED_EMPTY_FEED_CHANNEL_IDS.has(ch.channelId)) {
      report(kind, `${ch.name} (${ch.handle})`, false, `HTTP 200, mas feed de vídeos vazio (0 itens)`);
      return;
    }
    const detail = parsed.items.length === 0
      ? "HTTP 200, feed vazio (permitido: ressalva documentada)"
      : `HTTP 200, ${parsed.items.length} vídeos`;
    report(kind, `${ch.name} (${ch.handle})`, true, detail);
  } catch (err) {
    report(kind, `${ch.name} (${ch.handle})`, false, formatError(err));
  }
}

async function main(): Promise<void> {
  const sources = loadSources();
  const feeds = sources.feeds ?? [];
  const channels = [
    ...(sources.youtubeChannels ?? []).map((c) => ({ kind: "YT-CANAL", ch: c })),
    ...(sources.companyChannels ?? []).map((c) => ({ kind: "CANAL-EMPRESA", ch: c })),
  ];

  console.log(`=== AI Pulse verify-sources: ${feeds.length} feeds, ${channels.length} canais ===\n`);

  for (const feed of feeds) await checkFeed(feed);
  console.log("");
  for (const { kind, ch } of channels) await checkChannel(kind, ch);

  console.log(`\n=== Resumo: ${failures === 0 ? "TODAS AS CHECAGENS OK" : `${failures} FALHA(S)`} ===`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[verify-sources] Erro fatal:", formatError(err));
  process.exit(1);
});
