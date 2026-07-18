import type { ModelRecord } from "../types.js";

const AA_PUBLIC_URLS = [
  "https://artificialanalysis.ai/leaderboards/models?_rsc=1",
  "https://artificialanalysis.ai/models?_rsc=1",
  "https://artificialanalysis.ai/models",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface AaSiteModel {
  slug?: string;
  name?: string;
  shortName?: string;
  intelligenceIndex?: number | null;
  codingIndex?: number | null;
  mathIndex?: number | null;
  price1mInputTokens?: number | null;
  price1mOutputTokens?: number | null;
  /** Standard 3:1 blend — named 0To3To1 on the public site payload. */
  price1mBlended0To3To1?: number | null;
  price1mBlended3To1?: number | null;
  price1mBlended7To2To1?: number | null;
  medianOutputSpeed?: number | null;
  medianOutputTokensPerSecond?: number | null;
  medianCanonicalAnswerOutputSpeed?: number | null;
  medianTimeToFirstChunk?: number | null;
  medianTimeToFirstTokenSeconds?: number | null;
  isOpenWeights?: boolean;
  openSourceCategorization?: string | null;
  creator?: { name?: string; slug?: string } | null;
}

function blendedPrice(input: number, output: number): number {
  return input * 0.75 + output * 0.25;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function richness(m: AaSiteModel): number {
  let score = 0;
  if (num(m.intelligenceIndex) > 0) score += 10;
  if (num(m.codingIndex) > 0) score += 5;
  if (num(m.mathIndex) > 0) score += 5;
  if (num(m.price1mInputTokens) > 0 || num(m.price1mOutputTokens) > 0) score += 4;
  if (num(m.price1mBlended0To3To1) > 0 || num(m.price1mBlended3To1) > 0) score += 2;
  if (
    num(m.medianOutputTokensPerSecond) > 0 ||
    num(m.medianOutputSpeed) > 0 ||
    num(m.medianCanonicalAnswerOutputSpeed) > 0
  ) {
    score += 4;
  }
  if (m.creator?.name) score += 1;
  if (typeof m.isOpenWeights === "boolean") score += 1;
  return score;
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

function findObjectStartForSlug(text: string, slugIndex: number): number {
  const windowStart = Math.max(0, slugIndex - 120);
  const before = text.slice(windowStart, slugIndex);
  const idMatch = before.lastIndexOf('{"id":"');
  if (idMatch >= 0) return windowStart + idMatch;

  for (let i = slugIndex; i >= 0; i--) {
    if (text[i] === "{") return i;
  }
  return -1;
}

/**
 * AA embeds multiple objects per slug (thin highlight cards + full model rows).
 * Keep the richest object so speed/price/coding are not dropped.
 */
function parseSiteModels(payload: string): AaSiteModel[] {
  const best = new Map<string, AaSiteModel>();
  const slugRe = /"slug":"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = slugRe.exec(payload)) !== null) {
    const slug = match[1];
    if (!slug) continue;

    const start = findObjectStartForSlug(payload, match.index);
    if (start < 0) continue;
    const json = extractBalancedObject(payload, start);
    if (!json || !json.includes('"intelligenceIndex"')) continue;

    try {
      const obj = JSON.parse(json) as AaSiteModel;
      if (!obj.slug || !obj.name) continue;
      if (typeof obj.intelligenceIndex !== "number" || obj.intelligenceIndex <= 0) continue;

      const prev = best.get(obj.slug);
      if (!prev || richness(obj) > richness(prev)) {
        best.set(obj.slug, obj);
      }
    } catch {
      // Skip malformed RSC fragments.
    }
  }

  return [...best.values()];
}

function accessibilityFor(m: AaSiteModel): { accessibility: string; accessibilityScore: number } {
  const cat = (m.openSourceCategorization ?? "").toLowerCase().replace(/_/g, "-");
  if (m.isOpenWeights === true || cat === "open-source" || cat === "open-weights" || cat === "open") {
    return { accessibility: "Open weights", accessibilityScore: 4 };
  }
  if (cat === "gated") {
    return { accessibility: "Gated", accessibilityScore: 3 };
  }
  return { accessibility: "API only", accessibilityScore: 1 };
}

function toModelRecord(m: AaSiteModel, fetchedAt: string): ModelRecord | null {
  if (!m.slug || !m.name) return null;
  const intelligence = num(m.intelligenceIndex);
  if (intelligence <= 0) return null;

  const priceInput = num(m.price1mInputTokens);
  const priceOutput = num(m.price1mOutputTokens);
  // Prefer AA's standard 3:1 blend (public field is price1mBlended0To3To1).
  // Never use 7:2:1 cache-heavy blends — they understate frontier API cost.
  const priceBlended =
    num(m.price1mBlended0To3To1) ||
    num(m.price1mBlended3To1) ||
    (priceInput || priceOutput ? blendedPrice(priceInput, priceOutput) : 0);

  const speed =
    num(m.medianOutputTokensPerSecond) ||
    num(m.medianOutputSpeed) ||
    num(m.medianCanonicalAnswerOutputSpeed);

  const latency = num(m.medianTimeToFirstTokenSeconds) || num(m.medianTimeToFirstChunk);

  const access = accessibilityFor(m);

  return {
    slug: m.slug,
    name: m.name,
    creator: m.creator?.name ?? "Unknown",
    intelligence,
    coding: num(m.codingIndex),
    math: num(m.mathIndex),
    priceInput,
    priceOutput,
    priceBlended,
    speed,
    latency,
    accessibility: access.accessibility,
    accessibilityScore: access.accessibilityScore,
    fetchedAt,
    url: `https://artificialanalysis.ai/models/${m.slug}`,
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
 * Prefer this for field completeness (speed, pricing, frontier models).
 */
export async function fetchAaPublicSiteModels(): Promise<ModelRecord[]> {
  const fetchedAt = new Date().toISOString();

  for (const url of AA_PUBLIC_URLS) {
    try {
      const payload = await fetchPayload(url);
      if (!payload) continue;

      const raw = parseSiteModels(payload);
      const models = raw
        .map((m) => toModelRecord(m, fetchedAt))
        .filter((m): m is ModelRecord => m !== null);

      if (models.length === 0) {
        console.warn(`[AA Public] Parsed 0 models from ${url}`);
        continue;
      }

      const withSpeed = models.filter((m) => m.speed > 0).length;
      const withCoding = models.filter((m) => m.coding > 0).length;
      const withPrice = models.filter((m) => m.priceBlended > 0).length;
      const hasFable = models.some((m) => m.slug.includes("fable"));
      console.log(
        `[AA Public] Fetched ${models.length} models from ${url}` +
          ` (coding=${withCoding}, speed=${withSpeed}, price=${withPrice}` +
          (hasFable ? ", includes Fable)" : ", Fable not found)"),
      );
      return models;
    } catch (err) {
      console.warn(`[AA Public] Failed ${url}:`, err);
    }
  }

  console.warn("[AA Public] All public-site fetches failed — continuing with API-only data");
  return [];
}
