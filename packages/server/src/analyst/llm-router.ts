import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * Resilient cloud LLM router.
 *
 * Curation must never depend on a single free tier. We keep an ordered list of
 * cloud candidates (provider + model). Each call walks the list, skipping any
 * candidate that is unconfigured or in cooldown, and returns the first JSON
 * result. Rate-limited candidates back off (honoring the provider's retry hint)
 * so we stop hammering an exhausted quota; unavailable models (bad id / no
 * access) are parked for a day. When every candidate is down the caller falls
 * back to deterministic rules — but we record that so the UI can show it.
 */

export type AnalystProvider = "gemini" | "groq" | "cerebras" | "openrouter";

export interface AnalystEnv {
  geminiKey?: string;
  groqKey?: string;
  cerebrasKey?: string;
  openrouterKey?: string;
}

export interface LlmResult {
  data: Record<string, unknown>;
  provider: AnalystProvider;
  model: string;
  label: string;
}

type OutcomeReason = "ok" | "idle" | "rate_limit" | "unavailable" | "error";

interface Candidate {
  id: string;
  provider: AnalystProvider;
  model: string;
  label: string;
  keyOf: (env: AnalystEnv) => string | undefined;
  call: (prompt: string, apiKey: string) => Promise<Record<string, unknown> | null>;
}

interface CandidateState {
  disabledUntil: number;
  reason: OutcomeReason;
  lastError: string | null;
  lastOkAt: number | null;
}

export interface CandidateStatus {
  id: string;
  provider: AnalystProvider;
  model: string;
  label: string;
  configured: boolean;
  available: boolean;
  reason: OutcomeReason;
  cooldownMs: number;
  lastError: string | null;
  lastOkAt: string | null;
}

const LLM_TIMEOUT_MS = 45_000;
const RATE_LIMIT_DEFAULT_MS = 45 * 60_000;
const RATE_LIMIT_MAX_MS = 6 * 60 * 60_000;
const UNAVAILABLE_COOLDOWN_MS = 12 * 60 * 60_000;
const ERROR_COOLDOWN_MS = 2 * 60_000;

const state = new Map<string, CandidateState>();

function stateOf(id: string): CandidateState {
  let s = state.get(id);
  if (!s) {
    s = { disabledUntil: 0, reason: "idle", lastError: null, lastOkAt: null };
    state.set(id, s);
  }
  return s;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyError(message: string): { reason: OutcomeReason; cooldownMs: number } {
  if (/429|rate.?limit|quota|RESOURCE_EXHAUSTED|tokens per (day|minute)|\bTPD\b|\bRPD\b/i.test(message)) {
    // Honor an explicit retry hint if the provider gives one.
    const retryMin = message.match(/try again in\s+(\d+)m([\d.]+)?s/i);
    const retrySec = message.match(/retry in\s+([\d.]+)s/i);
    let cooldownMs = RATE_LIMIT_DEFAULT_MS;
    if (retryMin) {
      const mins = Number(retryMin[1]) || 0;
      const secs = Number(retryMin[2]) || 0;
      cooldownMs = (mins * 60 + secs) * 1000 + 30_000;
    } else if (retrySec) {
      cooldownMs = (Number(retrySec[1]) + 5) * 1000;
    }
    return { reason: "rate_limit", cooldownMs: Math.min(cooldownMs, RATE_LIMIT_MAX_MS) };
  }
  if (/\b(400|401|403|404)\b|not found|does not exist|no access|permission|unauthorized|invalid.*(model|api key|key)|model_not_found|decommission/i.test(message)) {
    return { reason: "unavailable", cooldownMs: UNAVAILABLE_COOLDOWN_MS };
  }
  return { reason: "error", cooldownMs: ERROR_COOLDOWN_MS };
}

// ---- Provider call implementations -----------------------------------------

async function callGeminiJson(model: string, prompt: string, apiKey: string): Promise<Record<string, unknown> | null> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
        abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
    }),
    LLM_TIMEOUT_MS + 2_000,
    `Gemini ${model}`,
  );
  const text = response.text;
  return text ? extractJsonObject(text) : null;
}

async function callGroqJson(model: string, prompt: string, apiKey: string): Promise<Record<string, unknown> | null> {
  const groq = new Groq({ apiKey });
  const completion = await withTimeout(
    groq.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    LLM_TIMEOUT_MS,
    `Groq ${model}`,
  );
  const text = completion.choices[0]?.message?.content;
  return text ? extractJsonObject(text) : null;
}

async function callOpenAICompatibleJson(opts: {
  baseUrl: string;
  model: string;
  prompt: string;
  apiKey: string;
  jsonMode: boolean;
  headers?: Record<string, string>;
  label: string;
}): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      temperature: 0.3,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${opts.label} ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  return text ? extractJsonObject(text) : null;
}

// ---- Candidate list (priority order) ---------------------------------------
// Ordering balances quality, free-tier generosity, and token economy: Gemini
// Flash first (best free quality), then Cerebras (very generous + fast), then a
// light Groq model, then OpenRouter free pools, then extra Gemini capacity.

const CANDIDATES: Candidate[] = [
  {
    id: "gemini:gemini-3.5-flash",
    provider: "gemini",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    keyOf: (e) => e.geminiKey,
    call: (prompt, key) => callGeminiJson("gemini-3.5-flash", prompt, key),
  },
  {
    id: "cerebras:llama-3.3-70b",
    provider: "cerebras",
    model: "llama-3.3-70b",
    label: "Cerebras Llama 3.3 70B",
    keyOf: (e) => e.cerebrasKey,
    call: (prompt, key) =>
      callOpenAICompatibleJson({
        baseUrl: "https://api.cerebras.ai/v1",
        model: "llama-3.3-70b",
        prompt,
        apiKey: key,
        jsonMode: true,
        label: "Cerebras",
      }),
  },
  {
    id: "groq:llama-3.1-8b-instant",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    label: "Groq Llama 3.1 8B",
    keyOf: (e) => e.groqKey,
    call: (prompt, key) => callGroqJson("llama-3.1-8b-instant", prompt, key),
  },
  {
    id: "openrouter:llama-3.3-70b:free",
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    label: "OpenRouter Llama 3.3 70B (free)",
    keyOf: (e) => e.openrouterKey,
    call: (prompt, key) =>
      callOpenAICompatibleJson({
        baseUrl: "https://openrouter.ai/api/v1",
        model: "meta-llama/llama-3.3-70b-instruct:free",
        prompt,
        apiKey: key,
        jsonMode: false,
        headers: { "X-Title": "AI Pulse", "HTTP-Referer": "https://github.com/FernandoSLuz/ai-pulse" },
        label: "OpenRouter",
      }),
  },
  {
    id: "gemini:gemini-2.5-flash",
    provider: "gemini",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    keyOf: (e) => e.geminiKey,
    call: (prompt, key) => callGeminiJson("gemini-2.5-flash", prompt, key),
  },
  {
    id: "openrouter:deepseek-chat:free",
    provider: "openrouter",
    model: "deepseek/deepseek-chat-v3-0324:free",
    label: "OpenRouter DeepSeek V3 (free)",
    keyOf: (e) => e.openrouterKey,
    call: (prompt, key) =>
      callOpenAICompatibleJson({
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-chat-v3-0324:free",
        prompt,
        apiKey: key,
        jsonMode: false,
        headers: { "X-Title": "AI Pulse", "HTTP-Referer": "https://github.com/FernandoSLuz/ai-pulse" },
        label: "OpenRouter",
      }),
  },
];

function markOk(id: string): void {
  const s = stateOf(id);
  s.disabledUntil = 0;
  s.reason = "ok";
  s.lastError = null;
  s.lastOkAt = Date.now();
}

function markFailure(id: string, message: string): OutcomeReason {
  const { reason, cooldownMs } = classifyError(message);
  const s = stateOf(id);
  s.disabledUntil = Date.now() + cooldownMs;
  s.reason = reason;
  s.lastError = message.slice(0, 300);
  return reason;
}

/**
 * Try each configured candidate in priority order and return the first JSON
 * result. Returns null only when every candidate is unconfigured, cooling down,
 * or failing — the signal for the caller to fall back to rules.
 */
export async function routeLlmJson(prompt: string, env: AnalystEnv): Promise<LlmResult | null> {
  const now = Date.now();
  let sawConfigured = false;

  for (const c of CANDIDATES) {
    const apiKey = c.keyOf(env);
    if (!apiKey) continue;
    sawConfigured = true;

    const s = stateOf(c.id);
    if (now < s.disabledUntil) continue;

    try {
      const data = await c.call(prompt, apiKey);
      if (data) {
        markOk(c.id);
        return { data, provider: c.provider, model: c.model, label: c.label };
      }
      // Empty/unparseable response — brief cooldown, keep walking.
      markFailure(c.id, "empty or non-JSON response");
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const reason = markFailure(c.id, message);
      const tag = reason === "rate_limit" ? "rate-limited" : reason === "unavailable" ? "unavailable" : "failed";
      console.warn(`[Analyst] ${c.label} ${tag}: ${message.slice(0, 160)}`);
    }
  }

  if (!sawConfigured) {
    console.warn("[Analyst] No cloud AI key configured — using deterministic rules.");
  }
  return null;
}

/** Snapshot of every candidate for the health endpoint / settings UI. */
export function getAnalystStatus(env: AnalystEnv): {
  candidates: CandidateStatus[];
  configuredCount: number;
  availableCount: number;
} {
  const now = Date.now();
  const candidates = CANDIDATES.map((c): CandidateStatus => {
    const configured = Boolean(c.keyOf(env));
    const s = stateOf(c.id);
    const cooldownMs = Math.max(0, s.disabledUntil - now);
    return {
      id: c.id,
      provider: c.provider,
      model: c.model,
      label: c.label,
      configured,
      available: configured && cooldownMs === 0,
      reason: s.reason,
      cooldownMs,
      lastError: s.lastError,
      lastOkAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
    };
  });
  return {
    candidates,
    configuredCount: candidates.filter((c) => c.configured).length,
    availableCount: candidates.filter((c) => c.available).length,
  };
}
