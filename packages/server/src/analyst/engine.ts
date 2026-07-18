import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import {
  buildAnalystPrompt,
  buildRulesBriefing,
  buildAiPickPrompt,
  buildBatchedAiPickPrompt,
  buildRulesAiPicks,
} from "./prompts.js";
import { findUpgradeCandidates } from "../my-stack.js";
import {
  getLatestBriefing,
  getMyStack,
  saveBriefing,
  getNews,
  clearAiPicksForPeriod,
  setAiPicks,
} from "../db.js";
import type { AnalystBriefing, ChangeEvent, ModelRecord, NewsItem, NewsPeriod } from "../types.js";

export type AnalystLlmSource = "gemini" | "ollama" | "groq";

export interface AnalystEnv {
  geminiKey?: string;
  groqKey?: string;
  ollamaEnabled?: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
}

interface BriefingContext {
  newModelSlugs: string[];
  leaderChanges: string[];
  topNews: NewsItem[];
  models: ModelRecord[];
}

/** Skip Groq until this time after a daily/rate-limit 429. */
let groqCooldownUntil = 0;

function groqAvailable(): boolean {
  return Date.now() >= groqCooldownUntil;
}

function noteGroqRateLimit(err: unknown): void {
  const message = (err as Error)?.message ?? String(err);
  if (!/429|rate.?limit|tokens per day|TPD/i.test(message)) return;

  const retryMatch = message.match(/try again in\s+(\d+)m([\d.]+)?s/i);
  let waitMs = 45 * 60_000;
  if (retryMatch) {
    const mins = Number(retryMatch[1]) || 0;
    const secs = Number(retryMatch[2]) || 0;
    waitMs = Math.min((mins * 60 + secs) * 1000 + 30_000, 6 * 60 * 60_000);
  }
  groqCooldownUntil = Date.now() + waitMs;
  console.warn(
    `[Analyst] Groq rate-limited — skipping Groq for ~${Math.ceil(waitMs / 60_000)}m (using Gemini/Ollama/rules)`,
  );
}

function extractJsonObject(text: string): Record<string, unknown> | null {
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

/** Skip Gemini until this time after a free-tier 429. */
let geminiCooldownUntil = 0;

function geminiAvailable(): boolean {
  return Date.now() >= geminiCooldownUntil;
}

function noteGeminiRateLimit(err: unknown): void {
  const message = (err as Error)?.message ?? String(err);
  if (!/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message)) return;

  const retryMatch = message.match(/retry in\s+([\d.]+)s/i);
  const waitMs = retryMatch
    ? Math.min((Number(retryMatch[1]) + 5) * 1000, 60 * 60_000)
    : 60_000;
  geminiCooldownUntil = Math.max(geminiCooldownUntil, Date.now() + waitMs);
  console.warn(
    `[Analyst] Gemini rate-limited — skipping Gemini for ~${Math.ceil(waitMs / 1000)}s (using Ollama/Groq/rules)`,
  );
}

const LLM_TIMEOUT_MS = 45_000;

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

async function callGemini(prompt: string, apiKey: string): Promise<Record<string, unknown> | null> {
  if (!geminiAvailable()) return null;

  // Stick to the same free model chat uses — older flash variants often have limit: 0 for new keys.
  const model = "gemini-3.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  try {
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
    if (!text) return null;
    return extractJsonObject(text);
  } catch (err) {
    noteGeminiRateLimit(err);
    console.warn("[Analyst] Gemini failed:", (err as Error).message);
    return null;
  }
}

async function callGroq(prompt: string, apiKey: string): Promise<Record<string, unknown> | null> {
  if (!groqAvailable()) return null;
  try {
    const groq = new Groq({ apiKey });
    const completion = await withTimeout(
      groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      LLM_TIMEOUT_MS,
      "Groq",
    );
    const text = completion.choices[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    noteGroqRateLimit(err);
    if (groqCooldownUntil > Date.now()) return null;
    console.warn("[Analyst] Groq failed:", (err as Error).message);
    return null;
  }
}

async function isOllamaHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function callOllama(prompt: string, url: string, model: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      console.warn("[Analyst] Ollama generate returned", res.status);
      return null;
    }
    const json = (await res.json()) as { response?: string };
    if (!json.response) return null;
    return extractJsonObject(json.response);
  } catch (err) {
    console.warn("[Analyst] Ollama generate failed:", (err as Error).message);
    return null;
  }
}

/**
 * Prefer Gemini (generous free tier) → local Ollama → Groq (with cooldown after 429).
 * Avoids burning Groq's tiny daily token budget on every poll.
 */
async function callLlmJson(
  prompt: string,
  env: AnalystEnv,
): Promise<{ data: Record<string, unknown>; source: AnalystLlmSource } | null> {
  if (env.geminiKey) {
    const parsed = await callGemini(prompt, env.geminiKey);
    if (parsed) return { data: parsed, source: "gemini" };
  }

  if (env.ollamaEnabled && env.ollamaUrl) {
    const healthy = await isOllamaHealthy(env.ollamaUrl);
    if (healthy) {
      const parsed = await callOllama(prompt, env.ollamaUrl, env.ollamaModel ?? "qwen2.5:7b");
      if (parsed) return { data: parsed, source: "ollama" };
    }
  }

  if (env.groqKey) {
    const parsed = await callGroq(prompt, env.groqKey);
    if (parsed) return { data: parsed, source: "groq" };
  }

  return null;
}

export async function generateBriefing(
  context: BriefingContext,
  env: AnalystEnv,
): Promise<AnalystBriefing> {
  const profile = getMyStack();
  const topModels = context.models.slice(0, 10);
  const upgradeCandidates = findUpgradeCandidates(context.models, profile);

  const promptContext = {
    diff: {
      newModelSlugs: context.newModelSlugs,
      leaderChanges: context.leaderChanges,
      topNews: context.topNews.slice(0, 5).map((n) => ({
        title: n.title,
        source: n.source,
        score: n.relevanceScore,
      })),
    },
    topModels,
    profile,
    upgradeCandidates,
  };

  const llm = await callLlmJson(buildAnalystPrompt(promptContext), env);
  const rules = buildRulesBriefing(promptContext);
  const data = llm?.data ?? rules;

  return saveBriefing({
    headline: String(data.headline ?? rules.headline),
    breaking: Array.isArray(data.breaking) ? data.breaking.map(String) : rules.breaking,
    watchList: Array.isArray(data.watchList) ? data.watchList.map(String) : rules.watchList,
    newModels: Array.isArray(data.newModels) ? data.newModels.map(String) : rules.newModels,
    yourStack: String(data.yourStack ?? rules.yourStack),
    upgradeSuggestion: data.upgradeSuggestion ? String(data.upgradeSuggestion) : rules.upgradeSuggestion,
    upgradeSlug: data.upgradeSlug ? String(data.upgradeSlug) : rules.upgradeSlug,
    analystSource: llm?.source ?? "rules",
    createdAt: new Date().toISOString(),
  });
}

function normalizePicks(
  raw: unknown,
  idSet: Set<string>,
  candidates: NewsItem[],
): { id: string; reason: string }[] {
  let picks: { id: string; reason: string }[] = [];
  if (Array.isArray(raw)) {
    picks = (raw as { id?: string; reason?: string }[])
      .filter((p) => p.id && idSet.has(p.id))
      .map((p) => ({ id: String(p.id), reason: String(p.reason ?? "Groundbreaking AI development") }))
      .slice(0, 8);
  }
  if (picks.length === 0) picks = buildRulesAiPicks(candidates);
  return picks;
}

export async function curateAiPicks(period: NewsPeriod, env: AnalystEnv): Promise<NewsItem[]> {
  const candidates = getNews(40, "all", period, "all");
  if (candidates.length === 0) {
    clearAiPicksForPeriod(period);
    return [];
  }

  const prompt = buildAiPickPrompt(
    period,
    candidates.map((n) => ({
      id: n.id,
      title: n.title,
      source: n.source,
      score: n.relevanceScore,
      summary: n.summary.slice(0, 160),
    })),
  );

  const llm = await callLlmJson(prompt, env);
  const idSet = new Set(candidates.map((c) => c.id));
  const picks = normalizePicks(llm?.data?.picks, idSet, candidates);

  clearAiPicksForPeriod(period);
  setAiPicks(picks.map((p) => ({ ...p, period })));
  return getNews(20, "all", period, "ai_pick");
}

/** One LLM call for all periods — avoids 5× token burn / rate-limit spam. */
export async function curateAiPicksAllPeriods(
  periods: NewsPeriod[],
  env: AnalystEnv,
): Promise<Record<string, NewsItem[]>> {
  const byPeriod: Record<string, NewsItem[]> = {};
  const candidateMap: Record<string, { id: string; title: string; source: string; score: number; summary: string }[]> =
    {};

  for (const period of periods) {
    const candidates = getNews(20, "all", period, "all");
    candidateMap[period] = candidates.map((n) => ({
      id: n.id,
      title: n.title,
      source: n.source,
      score: n.relevanceScore,
      summary: n.summary.slice(0, 80),
    }));
  }

  const llm = await callLlmJson(buildBatchedAiPickPrompt(candidateMap), env);
  const picksRoot = (llm?.data?.periods as Record<string, { picks?: unknown }>) ?? {};

  for (const period of periods) {
    const candidates = getNews(40, "all", period, "all");
    if (candidates.length === 0) {
      clearAiPicksForPeriod(period);
      byPeriod[period] = [];
      continue;
    }
    const idSet = new Set(candidates.map((c) => c.id));
    const periodPicks = picksRoot[period]?.picks ?? (llm?.data as { picks?: unknown })?.picks;
    const picks = normalizePicks(periodPicks, idSet, candidates);
    clearAiPicksForPeriod(period);
    setAiPicks(picks.map((p) => ({ ...p, period })));
    byPeriod[period] = getNews(20, "all", period, "ai_pick");
  }

  return byPeriod;
}

export function shouldRunAnalyst(event: ChangeEvent): boolean {
  return ["new_model", "leader_change", "high_news", "manual"].includes(event.type);
}

export function getCachedBriefing(): AnalystBriefing | null {
  return getLatestBriefing();
}
