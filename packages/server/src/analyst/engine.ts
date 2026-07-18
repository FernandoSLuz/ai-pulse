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

  const llm = await routeLlmJson(buildAnalystPrompt(promptContext), env);
  recordOutcome(llm);
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
    analystSource: llm?.provider ?? "rules",
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

  const llm = await routeLlmJson(prompt, env);
  recordOutcome(llm);
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

  const llm = await routeLlmJson(buildBatchedAiPickPrompt(candidateMap), env);
  recordOutcome(llm);
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
