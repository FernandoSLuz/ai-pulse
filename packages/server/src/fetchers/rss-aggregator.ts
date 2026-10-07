import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NewsItem } from "../types.js";
import { createHash } from "node:crypto";

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
    if (!/^https?:$/i.test(new URL(url).protocol)) return "";
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || key === "ref" || key === "fbclid") {
        u.searchParams.delete(key);
      }
    }
    let pathName = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host}${pathName}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

export function hashId(link: string, title = ""): string {
  return createHash("sha256").update(`${normalizeUrl(link)}|${title}`).digest("hex");
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
      .filter((t) => t.length > 2 || /^\d+$/.test(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function contradictoryTitles(a: Set<string>, b: Set<string>): boolean {
  const positive = ["up", "increase", "increases", "improves", "wins", "passes", "beats", "gain"];
  const negative = ["down", "decrease", "decreases", "drops", "loses", "fails", "decline", "cuts"];
  const has = (set: Set<string>, words: string[]) => words.some((w) => set.has(w));
  return (has(a, positive) && has(b, negative)) || (has(a, negative) && has(b, positive));
}

function numericTokens(tokens: Set<string>): Set<string> {
  return new Set([...tokens].filter((t) => /^\d+(?:\.\d+)?$/.test(t)));
}

export function hasAiSubject(title: string, summary: string): boolean {
  const text = `${title} ${summary}`;
  return /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|language model|foundation model|generative|openai|anthropic|deepmind|gemini|claude|gpt|llama|deepseek|mistral|qwen|xai|grok|embeddinggemma|gemma)(?:[- ]?\d+)?\b/i.test(text);
}

export function scoreRelevance(title: string, summary: string): { score: number; category: string } {
  if (!hasAiSubject(title, summary)) return { score: 30, category: "general" };
  const text = `${title} ${summary}`.toLowerCase();
  let score = 30;
  let category = "general";

  for (const kw of KEYWORDS) {
    if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)) score += 8;
  }
  if (RELEASE_WORDS.some((w) => new RegExp(`\\b${w}(?:s|es)?\\b`, "i").test(text))) {
    score += 20;
    category = "releases";
  }
  if (BENCHMARK_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text))) {
    score += 15;
    category = "benchmarks";
  }
  if (/\b(anthropic|openai|google|xai|deepmind|meta ai)\b/i.test(text)) {
    score += 10;
    category = category === "general" ? "labs" : category;
  }

  return { score: Math.min(score, 100), category };
}

function shouldIncludeSimonWillison(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return /\b(llm|model|gpt|claude|gemini|ai|api|benchmark)\b/i.test(text);
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
      if (contradictoryTitles(tokens, keptTokens[i])) continue;
      const numbers = numericTokens(tokens);
      const keptNumbers = numericTokens(keptTokens[i]);
      if (numbers.size !== keptNumbers.size || [...numbers].some((n) => !keptNumbers.has(n))) continue;
      if (jaccard(tokens, keptTokens[i]) >= SIMILARITY_THRESHOLD) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) continue;

    const clusterId = hashId(normLink || item.link, normalizeTitle(item.title).slice(0, 120));
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
            if (!hasAiSubject(title, summary)) continue;
            if (feed.source === "Simon Willison" && !shouldIncludeSimonWillison(title, summary)) continue;

            const link = normalizeUrl(entry.link ?? entry.guid ?? "");
            if (!link) continue;
            const rawDate = entry.isoDate ?? entry.pubDate;
            const publishedMs = rawDate ? Date.parse(rawDate) : Number.NaN;
            if (!Number.isFinite(publishedMs) || publishedMs > Date.now() + 5 * 60_000 || publishedMs < Date.now() - 90 * 24 * 60 * 60_000) continue;
            const { score, category } = scoreRelevance(title, summary);
            items.push({
              id: hashId(link),
              title,
              link,
              source: feed.source,
              publishedAt: new Date(publishedMs).toISOString(),
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
