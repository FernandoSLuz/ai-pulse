import type { ModelRecord } from "../types.js";

const AA_PUBLIC_URLS = [
  "https://artificialanalysis.ai/leaderboards/models?_rsc=1",
  "https://artificialanalysis.ai/models?_rsc=1",
  "https://artificialanalysis.ai/models",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * One row of AA's public leaderboard payload. The current payload serializes a
 * model as *two* objects that must be joined by slug:
 *   - metadata: { slug, name, creator, releaseDate, deprecated }
 *   - metrics:  { slug, shortName, intelligenceIndex, pricing, speed, ... }
 * Older payloads shipped a single object carrying both halves; this type keeps
 * every field either half may provide.
 */
interface AaSiteRow {
  slug?: string;
  name?: string;
  shortName?: string;
  deprecated?: boolean;
  isReasoning?: boolean;
  isOpenWeights?: boolean;
  modelCreatorName?: string;
  creator?: { name?: string; slug?: string } | null;
  releaseDate?: string;
  intelligenceIndex?: number | null;
  price1mInputTokens?: number | null;
  price1mOutputTokens?: number | null;
  /** Standard 3:1 blend — named 0To3To1 on the public site payload. */
  price1mBlended0To3To1?: number | null;
  price1mBlended3To1?: number | null;
  medianOutputTokensPerSecond?: number | null;
  medianOutputSpeed?: number | null;
  medianCanonicalAnswerOutputSpeed?: number | null;
  medianTimeToFirstTokenSeconds?: number | null;
  medianTimeToFirstChunk?: number | null;
}

function blendedPrice(input: number, output: number): number {
  return input * 0.75 + output * 0.25;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractBalancedObject(text: string, openBraceIndex: number): string | null {
  if (openBraceIndex < 0 || text[openBraceIndex] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

function rowRichness(row: AaSiteRow): number {
  let score = 0;
  if (row.creator?.name) score += 4;
  if (row.name) score += 2;
  if (row.releaseDate) score += 1;
  return score;
}

/**
 * Walk every `"slug"` occurrence, parse its enclosing balanced object, and
 * bucket it as a metric row (has intelligenceIndex) or a metadata row (has a
 * display name). Metric rows win first-seen; metadata keeps the richest twin
 * because `release.slug` also produces thin `{slug,name}` objects.
 */
function indexSiteRows(payload: string): { metrics: Map<string, AaSiteRow>; metadata: Map<string, AaSiteRow> } {
  const metrics = new Map<string, AaSiteRow>();
  const metadata = new Map<string, AaSiteRow>();
  const slugRe = /"slug":"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = slugRe.exec(payload)) !== null) {
    const slug = match[1];
    if (!slug) continue;

    const start = payload.lastIndexOf("{", match.index);
    if (start < 0) continue;
    const json = extractBalancedObject(payload, start);
    if (!json) continue;

    let row: AaSiteRow;
    try {
      row = JSON.parse(json) as AaSiteRow;
    } catch {
      continue; // malformed RSC fragment
    }
    if (!row.slug) continue;

    if (num(row.intelligenceIndex) > 0) {
      if (!metrics.has(row.slug)) metrics.set(row.slug, row);
    } else if (row.name) {
      const prev = metadata.get(row.slug);
      if (!prev || rowRichness(row) > rowRichness(prev)) metadata.set(row.slug, row);
    }
  }

  return { metrics, metadata };
}

function joinRow(metric: AaSiteRow, meta: AaSiteRow | undefined): AaSiteRow {
  return {
    ...metric,
    name: meta?.name ?? metric.shortName,
    creator: meta?.creator ?? null,
    modelCreatorName: meta?.creator?.name ?? metric.modelCreatorName,
    deprecated: meta?.deprecated === true || metric.deprecated === true,
    isOpenWeights: metric.isOpenWeights === true || meta?.isOpenWeights === true,
    releaseDate: meta?.releaseDate,
  };
}

function toModelRecord(row: AaSiteRow, fetchedAt: string): ModelRecord | null {
  if (!row.slug || !row.name) return null;
  // AA keeps retired models in the payload for history. They must never rank
  // against current ones.
  if (row.deprecated === true) return null;

  const intelligence = num(row.intelligenceIndex);
  if (intelligence <= 0) return null;

  const priceInput = num(row.price1mInputTokens);
  const priceOutput = num(row.price1mOutputTokens);
  // Prefer AA's standard 3:1 blend (public field is price1mBlended0To3To1).
  // Never use 7:2:1 cache-heavy blends — they understate frontier API cost.
  const priceBlended =
    num(row.price1mBlended0To3To1) ||
    num(row.price1mBlended3To1) ||
    (priceInput || priceOutput ? blendedPrice(priceInput, priceOutput) : 0);

  const speed =
    num(row.medianOutputTokensPerSecond) ||
    num(row.medianOutputSpeed) ||
    num(row.medianCanonicalAnswerOutputSpeed);

  const latency = num(row.medianTimeToFirstTokenSeconds) || num(row.medianTimeToFirstChunk);

  const openWeights = row.isOpenWeights === true;

  return {
    slug: row.slug,
    name: row.name,
    creator: row.creator?.name ?? row.modelCreatorName ?? "Unknown",
    intelligence,
    // AA's public leaderboard no longer publishes the composite Coding/Math
    // indexes (only raw eval scores). The keyed API still does, and its rows
    // merge in when a working AA_API_KEY is configured.
    coding: 0,
    math: 0,
    priceInput,
    priceOutput,
    priceBlended,
    speed,
    latency,
    accessibility: openWeights ? "Open weights" : "API only",
    accessibilityScore: openWeights ? 4 : 1,
    fetchedAt,
    url: `https://artificialanalysis.ai/models/${row.slug}`,
  };
}

async function fetchPayload(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/x-component, text/html, application/json, */*",
      RSC: "1",
    },
  });
  if (!res.ok) {
    console.warn(`[AA Public] ${url} returned ${res.status}`);
    return null;
  }
  return res.text();
}

/**
 * Free, no-key fetch of Artificial Analysis public leaderboard (RSC payload).
 * This is the primary benchmark source: it carries the full current model list
 * with creator, pricing and speed, and needs no API key.
 */
export async function fetchAaPublicSiteModels(): Promise<ModelRecord[]> {
  const fetchedAt = new Date().toISOString();

  for (const url of AA_PUBLIC_URLS) {
    try {
      const payload = await fetchPayload(url);
      if (!payload) continue;

      const { metrics, metadata } = indexSiteRows(payload);
      const rows = [...metrics.values()].map((m) => joinRow(m, metadata.get(m.slug ?? "")));
      const models = rows
        .map((r) => toModelRecord(r, fetchedAt))
        .filter((m): m is ModelRecord => m !== null);

      if (models.length === 0) {
        console.warn(`[AA Public] Parsed 0 live models from ${url} (${metrics.size} metric rows)`);
        continue;
      }

      const withCreator = models.filter((m) => m.creator !== "Unknown").length;
      const withSpeed = models.filter((m) => m.speed > 0).length;
      const withPrice = models.filter((m) => m.priceBlended > 0).length;
      console.log(
        `[AA Public] Fetched ${models.length} models from ${url}` +
          ` (${metrics.size - models.length} deprecated skipped, creator=${withCreator},` +
          ` speed=${withSpeed}, price=${withPrice})`,
      );
      return models;
    } catch (err) {
      console.warn(`[AA Public] Failed ${url}:`, err);
    }
  }

  console.warn("[AA Public] All public-site fetches failed — continuing with API-only data");
  return [];
}
