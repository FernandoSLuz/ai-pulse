import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NewsItem } from "../types.js";

const FEED_TIMEOUT_MS = 15_000;
const parser = new Parser();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface NewsFetchResult {
  items: NewsItem[];
  feedsOk: number;
  feedsFailed: number;
}

function isRetryableFeedError(message: string): boolean {
  return /timed out|TimeoutError|abort|EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up|503|502/i.test(
    message,
  );
}

function formatFetchError(err: unknown): string {
  const e = err as Error;
  if (e.name === "TimeoutError" || e.name === "AbortError") {
    return `timed out after ${FEED_TIMEOUT_MS}ms`;
  }
  return e.message ?? String(err);
}

async function fetchFeedXml(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: {
      "User-Agent": "AI-Pulse/1.0 (+https://localhost; RSS reader)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function parseFeedWithRetry(url: string) {
  try {
    const xml = await fetchFeedXml(url);
    return parser.parseString(xml);
  } catch (err) {
    if (!isRetryableFeedError(formatFetchError(err))) throw err;
    await new Promise((r) => setTimeout(r, 750));
    const xml = await fetchFeedXml(url);
    return parser.parseString(xml);
  }
}

interface FeedConfig {
  url: string;
  source: string;
  tier: number;
}

interface SourcesConfig {
  feeds: FeedConfig[];
}

function loadFeeds(): FeedConfig[] {
  const base = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..", "..");
  const configPath = path.join(base, "config", "sources.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as SourcesConfig;
    return raw.feeds ?? [];
  } catch (err) {
    console.warn("[RSS] Failed to load sources.json:", (err as Error).message);
    return [];
  }
}

const KEYWORDS = [
  "fable", "grok", "gpt", "claude", "gemini", "llama", "deepseek", "mistral", "qwen",
  "release", "benchmark", "leaderboard", "sota", "model", "opus", "sonnet", "api",
  "anthropic", "openai", "agent", "reasoning", "frontier",
];

const RELEASE_WORDS = ["release", "launch", "announce", "introducing", "available", "drop", "unveil"];
const BENCHMARK_WORDS = ["benchmark", "leaderboard", "sota", "eval", "score", "arena"];

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || key === "ref" || key === "fbclid") {
        u.searchParams.delete(key);
      }
    }
    let pathName = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${pathName}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function hashId(link: string, title: string): string {
  return Buffer.from(`${link}|${title}`).toString("base64url").slice(0, 32);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function scoreRelevance(title: string, summary: string): { score: number; category: string } {
  const text = `${title} ${summary}`.toLowerCase();
  let score = 30;
  let category = "general";

  for (const kw of KEYWORDS) {
    if (text.includes(kw)) score += 8;
  }
  if (RELEASE_WORDS.some((w) => text.includes(w))) {
    score += 20;
    category = "releases";
  }
  if (BENCHMARK_WORDS.some((w) => text.includes(w))) {
    score += 15;
    category = "benchmarks";
  }
  if (text.includes("anthropic") || text.includes("openai") || text.includes("google") || text.includes("xai") || text.includes("deepmind") || text.includes("meta ai")) {
    score += 10;
    category = category === "general" ? "labs" : category;
  }

  return { score: Math.min(score, 100), category };
}

function shouldIncludeSimonWillison(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return ["llm", "model", "gpt", "claude", "gemini", "ai", "api", "benchmark"].some((k) => text.includes(k));
}

const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000;
const SIMILARITY_THRESHOLD = 0.55;

/** Keep one story per near-duplicate cluster: lowest tier, then highest score, then earliest. */
export function dedupeByCredibility(items: NewsItem[]): NewsItem[] {
  const sorted = [...items].sort(
    (a, b) =>
      (a.tier ?? 99) - (b.tier ?? 99) ||
      b.relevanceScore - a.relevanceScore ||
      new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  const kept: NewsItem[] = [];
  const keptTokens: Set<string>[] = [];
  const keptTimes: number[] = [];
  const keptUrls = new Set<string>();

  for (const item of sorted) {
    const normLink = normalizeUrl(item.link);
    if (keptUrls.has(normLink)) continue;

    const tokens = titleTokens(item.title);
    const t = new Date(item.publishedAt).getTime();
    let duplicate = false;

    for (let i = 0; i < kept.length; i++) {
      if (Math.abs(t - keptTimes[i]) > CLUSTER_WINDOW_MS) continue;
      if (jaccard(tokens, keptTokens[i]) >= SIMILARITY_THRESHOLD) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) continue;

    const clusterId = hashId(normalizeTitle(item.title).slice(0, 48), String(Math.floor(t / CLUSTER_WINDOW_MS)));
    kept.push({ ...item, link: normLink || item.link, clusterId });
    keptTokens.push(tokens);
    keptTimes.push(t);
    if (normLink) keptUrls.add(normLink);
  }

  return kept.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore ||
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export async function fetchAllNews(): Promise<NewsFetchResult> {
  const feeds = loadFeeds();
  const items: NewsItem[] = [];
  let feedsOk = 0;
  let feedsFailed = 0;

  // Stagger bursts slightly to reduce DNS/timeout storms under flaky networks.
  const concurrency = 5;
  for (let i = 0; i < feeds.length; i += concurrency) {
    const batch = feeds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (feed) => {
        try {
          const parsed = await parseFeedWithRetry(feed.url);
          feedsOk += 1;
          for (const entry of parsed.items.slice(0, 15)) {
            const rawTitle = entry.title ?? "Untitled";
            const rawSummary = entry.contentSnippet ?? entry.content ?? entry.summary ?? "";
            const title = stripHtml(rawTitle);
            const summary = stripHtml(rawSummary);
            if (feed.source === "Simon Willison" && !shouldIncludeSimonWillison(title, summary)) continue;

            const link = normalizeUrl(entry.link ?? entry.guid ?? "");
            const { score, category } = scoreRelevance(title, summary);
            items.push({
              id: hashId(link || title, title),
              title,
              link: link || (entry.link ?? ""),
              source: feed.source,
              publishedAt: entry.isoDate ?? entry.pubDate ?? new Date().toISOString(),
              summary: summary.slice(0, 300),
              relevanceScore: score,
              category,
              tier: feed.tier,
            });
          }
        } catch (err) {
          feedsFailed += 1;
          console.warn(`[RSS] Failed ${feed.source}:`, formatFetchError(err));
        }
      }),
    );
  }

  if (feedsFailed > 0) {
    console.log(`[RSS] Completed with ${feedsOk} ok, ${feedsFailed} failed`);
  }

  return {
    items: dedupeByCredibility(items),
    feedsOk,
    feedsFailed,
  };
}
