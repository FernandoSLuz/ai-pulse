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

function blendedPrice(input: number, output: number): number {
  return input * 0.75 + output * 0.25;
}

function normalizeModel(raw: AaRawModel): ModelRecord | null {
  const slug = raw.slug ?? raw.name?.toLowerCase().replace(/\s+/g, "-");
  if (!slug || !raw.name) return null;

  const evals = raw.evaluations ?? {};
  const pricing = raw.pricing ?? {};
  const perf = raw.performance ?? {};
  const priceInput = pricing.price_1m_input_tokens ?? 0;
  const priceOutput = pricing.price_1m_output_tokens ?? 0;
  const priceBlended = pricing.price_1m_blended_3_to_1 ?? blendedPrice(priceInput, priceOutput);

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
    accessibility: "API only",
    accessibilityScore: 1,
    fetchedAt: new Date().toISOString(),
  };
}

function getDemoModels(): ModelRecord[] {
  const now = new Date().toISOString();
  const demo = [
    { slug: "claude-fable-5", name: "Claude Fable 5", creator: "Anthropic", intelligence: 60, coding: 58, math: 55, priceInput: 5, priceOutput: 25, speed: 70, latency: 1.2 },
    { slug: "claude-opus-4-8", name: "Claude Opus 4.8", creator: "Anthropic", intelligence: 56, coding: 54, math: 52, priceInput: 3, priceOutput: 15, speed: 62, latency: 1.5 },
    { slug: "gpt-5-5-xhigh", name: "GPT-5.5 (xhigh)", creator: "OpenAI", intelligence: 55, coding: 53, math: 58, priceInput: 4, priceOutput: 20, speed: 70, latency: 1.8 },
    { slug: "grok-4-5", name: "Grok 4.5", creator: "xAI", intelligence: 52, coding: 50, math: 48, priceInput: 2, priceOutput: 10, speed: 85, latency: 0.9 },
    { slug: "gemini-2-5-pro", name: "Gemini 2.5 Pro", creator: "Google", intelligence: 50, coding: 48, math: 51, priceInput: 1.5, priceOutput: 8, speed: 90, latency: 0.7 },
    { slug: "claude-sonnet-5", name: "Claude Sonnet 5", creator: "Anthropic", intelligence: 53, coding: 52, math: 49, priceInput: 3, priceOutput: 15, speed: 75, latency: 1.0 },
    { slug: "deepseek-r1", name: "DeepSeek R1", creator: "DeepSeek", intelligence: 48, coding: 55, math: 60, priceInput: 0.5, priceOutput: 2, speed: 60, latency: 2.0 },
    { slug: "llama-4-maverick", name: "Llama 4 Maverick", creator: "Meta", intelligence: 45, coding: 44, math: 42, priceInput: 0.2, priceOutput: 0.6, speed: 95, latency: 0.5 },
    { slug: "qwen-3-235b", name: "Qwen 3 235B", creator: "Alibaba", intelligence: 47, coding: 46, math: 50, priceInput: 0.3, priceOutput: 1.2, speed: 55, latency: 1.8 },
    { slug: "mistral-large-3", name: "Mistral Large 3", creator: "Mistral", intelligence: 46, coding: 47, math: 44, priceInput: 2, priceOutput: 6, speed: 80, latency: 0.8 },
  ];

  return demo.map((m) => ({
    ...m,
    priceBlended: blendedPrice(m.priceInput, m.priceOutput),
    accessibility: m.creator === "Meta" || m.creator === "DeepSeek" || m.creator === "Alibaba" ? "Open weights" : "API only",
    accessibilityScore: m.creator === "Meta" || m.creator === "DeepSeek" ? 4 : m.creator === "Alibaba" ? 3 : 1,
    fetchedAt: now,
  }));
}

export async function fetchArtificialAnalysisModels(apiKey?: string): Promise<ModelRecord[]> {
  if (!apiKey) {
    console.warn("[AA] No API key — using demo benchmark data. Add AA_API_KEY to .env for live data.");
    return getDemoModels();
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

  console.warn("[AA] All endpoints failed — falling back to demo data");
  return getDemoModels();
}
