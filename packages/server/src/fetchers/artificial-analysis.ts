import type { ModelRecord } from "../types.js";

// The /free endpoint is what free-tier keys can actually read; the others are
// plan-gated and return 401/403 for free keys (expected, not an error). Try the
// reachable one first so a healthy poll doesn't emit scary 403 warnings.
const AA_ENDPOINTS = [
  "https://artificialanalysis.ai/api/v2/language/models/free",
  "https://artificialanalysis.ai/api/v2/language/models",
  "https://artificialanalysis.ai/api/v2/data/llms/models",
];

interface AaPerformance {
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
}

interface AaRawModel {
  slug?: string;
  name?: string;
  model_creator?: { name?: string };
  evaluations?: Record<string, number>;
  pricing?: {
    price_1m_input_tokens?: number;
    price_1m_output_tokens?: number;
    price_1m_blended_3_to_1?: number;
  };
  performance?: AaPerformance;
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
}

function nullablePrice(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function blendedPrice(input: number, output: number): number {
  return input * 0.75 + output * 0.25;
}

function normalizeModel(raw: AaRawModel): ModelRecord | null {
  const slug = raw.slug ?? raw.name?.toLowerCase().replace(/\s+/g, "-");
  if (!slug || !raw.name) return null;

  const evals = raw.evaluations ?? {};
  const pricing = raw.pricing ?? {};
  const perf = raw.performance ?? {};
  const priceInput = nullablePrice(pricing.price_1m_input_tokens);
  const priceOutput = nullablePrice(pricing.price_1m_output_tokens);
  const explicitBlended = nullablePrice(pricing.price_1m_blended_3_to_1);
  const priceBlended = explicitBlended ??
    (priceInput !== null && priceOutput !== null ? blendedPrice(priceInput, priceOutput) : null);

  const speed =
    perf.median_output_tokens_per_second ??
    raw.median_output_tokens_per_second ??
    0;
  const latency =
    perf.median_time_to_first_token_seconds ??
    raw.median_time_to_first_token_seconds ??
    0;

  return {
    slug,
    name: raw.name,
    creator: raw.model_creator?.name ?? "Unknown",
    intelligence: evals.artificial_analysis_intelligence_index ?? 0,
    coding: evals.artificial_analysis_coding_index ?? 0,
    math: evals.artificial_analysis_math_index ?? 0,
    priceInput,
    priceOutput,
    priceBlended,
    speed,
    latency,
    accessibility: "Unknown",
    accessibilityScore: 0,
    license: null,
    licenseUrl: null,
    weightsUrl: null,
    priceSourceUrl: `https://artificialanalysis.ai/api/v2/language/models/free`,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Hardcoded rows shipped by older builds as a "demo" fallback when the keyed
 * API was unreachable. They were merged into the live leaderboard and, being
 * frozen at 2026-09 scores, outranked real current models (and resurrected
 * retired ones such as DeepSeek R1). They must never be seeded again; this list
 * exists only so a poll that has live data can delete leftovers.
 */
export const LEGACY_DEMO_SLUGS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "gpt-5-5-xhigh",
  "grok-4-5",
  "gemini-2-5-pro",
  "claude-sonnet-5",
  "deepseek-r1",
  "llama-4-maverick",
  "qwen-3-235b",
  "mistral-large-3",
];

export async function fetchArtificialAnalysisModels(apiKey?: string): Promise<ModelRecord[]> {
  if (!apiKey) {
    // Never fabricate rows: the public-site fetch covers the no-key case.
    console.debug("[AA] No API key — skipping the keyed API (public leaderboard still applies)");
    return [];
  }

  for (const endpoint of AA_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000), // don't let a hung connection wedge the poll
      });
      if (!res.ok) {
        // 401/403 just means this endpoint isn't on the free plan — expected,
        // log at debug level so it doesn't look like a failure.
        if (res.status === 401 || res.status === 403) {
          console.debug(`[AA] ${endpoint} not available on this plan (${res.status}) — trying next`);
        } else {
          console.warn(`[AA] ${endpoint} returned ${res.status}`);
        }
        continue;
      }
      const json = (await res.json()) as { data?: AaRawModel[] };
      const raw = json.data ?? (Array.isArray(json) ? json : []);
      const models = (raw as AaRawModel[])
        .map(normalizeModel)
        .filter((m): m is ModelRecord => m !== null && m.intelligence > 0);
      if (models.length > 0) {
        console.log(`[AA] Fetched ${models.length} models from ${endpoint}`);
        return models;
      }
    } catch (err) {
      console.warn(`[AA] Failed ${endpoint}:`, err);
    }
  }

  console.warn("[AA] All endpoints failed — no keyed benchmark data this poll");
  return [];
}
