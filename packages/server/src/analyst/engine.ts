import {
  buildAnalystPrompt,
  buildRulesBriefing,
  buildAiPickPrompt,
  buildBatchedAiPickPrompt,
  buildRulesAiPicks,
} from "./prompts.js";
import { routeLlmJson, getAnalystStatus, type AnalystEnv, type LlmResult } from "./llm-router.js";
import { findUpgradeCandidates } from "../my-stack.js";
import {
  getLatestBriefing,
  getMyStack,
  saveBriefing,
  getNews,
  clearAiPicksForPeriod,
  setAiPicks,
  setMeta,
  getMeta,
} from "../db.js";
import type { AnalystBriefing, ChangeEvent, ModelRecord, NewsItem, NewsPeriod } from "../types.js";

export type { AnalystEnv } from "./llm-router.js";
export { getAnalystStatus } from "./llm-router.js";

interface BriefingContext {
  newModelSlugs: string[];
  leaderChanges: string[];
  topNews: NewsItem[];
  models: ModelRecord[];
}

export interface AnalystOutcome {
  source: AnalystBriefing["analystSource"];
  model: string | null;
  degraded: boolean;
  at: string;
}

/**
 * Record which provider (if any) served the last curation so the UI can show
 * whether AI curation is healthy or degraded to deterministic rules.
 */
function recordOutcome(result: LlmResult | null): void {
  const outcome: AnalystOutcome = {
    source: result?.provider ?? "rules",
    model: result?.model ?? null,
    degraded: result === null,
    at: new Date().toISOString(),
  };
  setMeta("analyst_last_outcome", JSON.stringify(outcome));
}

function isPickList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
}

function hasBriefingShape(data: Record<string, unknown>): boolean {
  return typeof data.yourStack === "string" || typeof data.headlineNewsId === "string" || Array.isArray(data.breakingNewsIds);
}

function periodPickList(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return (value as { picks?: unknown }).picks;
  return undefined;
}

export function getAnalystOutcome(): AnalystOutcome | null {
  const raw = getMeta("analyst_last_outcome");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalystOutcome;
  } catch {
    return null;
  }
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
      topNews: context.topNews.slice(0, 5).map((n, i) => ({
        id: `n${i + 1}`,
        title: n.title,
        source: n.source,
        score: n.relevanceScore,
      })),
    },
    topModels,
    profile,
    upgradeCandidates,
  };

  const llm = await routeLlmJson(buildAnalystPrompt(promptContext), env);
  recordOutcome(llm && hasBriefingShape(llm.data) ? llm : null);
  const rules = buildRulesBriefing(promptContext);
  const data: Record<string, unknown> = llm?.data && typeof llm.data === "object"
    ? (llm.data as Record<string, unknown>)
    : (rules as unknown as Record<string, unknown>);
  const newsById = new Map(context.topNews.map((n, i) => [`n${i + 1}`, n]));
  const selectedHeadline = typeof data.headlineNewsId === "string" ? newsById.get(data.headlineNewsId) : undefined;
  const selectedBreaking = Array.isArray(data.breakingNewsIds)
    ? data.breakingNewsIds.filter((id): id is string => typeof id === "string").map((id) => newsById.get(id)).filter((n): n is NewsItem => Boolean(n)).slice(0, 3)
    : [];

  return saveBriefing({
    headline: selectedHeadline ? `${selectedHeadline.title} (${selectedHeadline.source})` : rules.headline,
    breaking: selectedBreaking.length ? selectedBreaking.map((n) => `${n.title} (${n.source})`) : rules.breaking,
    watchList: rules.watchList,
    newModels: rules.newModels,
    yourStack: rules.yourStack,
    upgradeSuggestion: rules.upgradeSuggestion,
    upgradeSlug: rules.upgradeSlug,
    analystSource: llm?.provider ?? "rules",
    createdAt: new Date().toISOString(),
  });
}

function normalizePicks(
  raw: unknown,
  idSet: Set<string>,
  candidates: NewsItem[],
  aliases?: Map<string, string>,
): { id: string; reason: string }[] {
  if (!Array.isArray(raw)) return buildRulesAiPicks(candidates);
  if (raw.length === 0) return [];
  const picks = (raw as { id?: string; reason?: string }[])
      .map((p) => ({ ...p, id: p.id ? (aliases?.get(String(p.id)) ?? String(p.id)) : "" }))
      .filter((p) => p.id && idSet.has(p.id))
      .map((p) => {
        const candidate = candidates.find((item) => item.id === p.id);
        const reason = candidate?.category === "releases"
          ? "Notable release or launch signal"
          : candidate?.category === "benchmarks"
            ? "Benchmark or leaderboard movement"
            : "High-relevance AI development";
        return { id: p.id, reason };
      })
      .slice(0, 8);
  return picks.length ? picks : buildRulesAiPicks(candidates);
}

export async function curateAiPicks(period: NewsPeriod, env: AnalystEnv): Promise<NewsItem[]> {
  const candidates = getNews(40, "all", period, "all");
  if (candidates.length === 0) {
    clearAiPicksForPeriod(period);
    return [];
  }

  const aliases = new Map<string, string>();
  const prompt = buildAiPickPrompt(
    period,
    candidates.map((n, i) => ({
      id: `n${i + 1}`,
      title: n.title,
      source: n.source,
      score: n.relevanceScore,
      summary: n.summary.slice(0, 160),
    })),
  );
  candidates.forEach((n, i) => aliases.set(`n${i + 1}`, n.id));

  const llm = await routeLlmJson(prompt, env);
  recordOutcome(llm && isPickList(llm.data?.picks) ? llm : null);
  const idSet = new Set(candidates.map((c) => c.id));
  const picks = normalizePicks(llm?.data?.picks, idSet, candidates, aliases);

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
  const aliases = new Map<string, string>();
  let nextId = 1;

  for (const period of periods) {
    const candidates = getNews(12, "all", period, "all");
    candidateMap[period] = candidates.map((n) => ({
      id: aliases.get(n.id) ?? (() => { const id = `n${nextId++}`; aliases.set(n.id, id); return id; })(),
      title: n.title,
      source: n.source,
      score: n.relevanceScore,
      summary: n.summary.slice(0, 80),
    }));
  }

  const llm = await routeLlmJson(buildBatchedAiPickPrompt(candidateMap), env);
  const isBatchShape = Boolean(llm?.data && typeof llm.data.periods === "object" && Object.values(llm.data.periods as Record<string, unknown>).every((value) => isPickList(periodPickList(value))));
  recordOutcome(llm && isBatchShape ? llm : null);
  const picksRoot = (llm?.data?.periods as Record<string, unknown>) ?? {};

  for (const period of periods) {
    const candidates = getNews(20, "all", period, "all");
    if (candidates.length === 0) {
      clearAiPicksForPeriod(period);
      byPeriod[period] = [];
      continue;
    }
    const idSet = new Set(candidates.map((c) => c.id));
    const reverseAliases = new Map([...aliases.entries()].map(([real, short]) => [short, real]));
    const periodPicks = periodPickList(picksRoot[period]) ?? (llm?.data as { picks?: unknown })?.picks;
    const picks = normalizePicks(periodPicks, idSet, candidates, reverseAliases);
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
