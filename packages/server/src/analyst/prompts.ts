import type { ModelRecord, MyStackProfile, NewsItem, NewsPeriod, UpgradeCandidate } from "../types.js";

export function buildAnalystPrompt(context: {
  diff: {
    newModelSlugs: string[];
    leaderChanges: string[];
    topNews: { id?: string; title: string; source: string; score: number }[];
  };
  topModels: ModelRecord[];
  profile: MyStackProfile;
  upgradeCandidates: UpgradeCandidate[];
}): string {
  const models = context.topModels.slice(0, 10).map((m) => ({
    slug: m.slug,
    name: m.name,
    creator: m.creator,
    intelligence: m.intelligence,
    coding: m.coding,
    math: m.math,
    priceBlended: m.priceBlended,
    speed: m.speed,
    accessibility: m.accessibility,
    license: m.license ?? null,
  }));
  const profile = {
    entries: context.profile.entries.slice(0, 5).map((e) => ({
      role: e.role,
      model: e.modelName || e.modelSlug,
      areas: e.areas,
      providers: e.providers,
    })),
    budgetTier: context.profile.budgetTier,
    priorities: [context.profile.priorityCoding, context.profile.priorityReasoning, context.profile.prioritySpeed, context.profile.priorityCost],
    roleGaps: context.profile.roleGaps.slice(0, 3).map((g) => ({ role: g.role, slug: g.modelSlug, name: g.modelName, reason: g.reason })),
  };
  const compact = {
    diff: {
      newModelSlugs: context.diff.newModelSlugs.slice(0, 8),
      leaderChanges: context.diff.leaderChanges.slice(0, 5),
      topNews: context.diff.topNews.slice(0, 5),
    },
    models,
    profile,
    upgrades: context.upgradeCandidates.slice(0, 6).map((c) => ({ slug: c.slug, name: c.name, score: c.score, intelligenceDelta: c.intelligenceDelta, priceDelta: c.priceDelta, reason: c.reason })),
  };
  return `You are AI Pulse analyst. Summarize the latest AI model landscape for a technical user. Write all output in English.

Return ONLY valid JSON with this exact shape:
{
  "headline": "one line summary",
  "breaking": ["bullet 1", "bullet 2"],
  "watchList": ["thing to watch 1"],
  "newModels": ["model name with key stat"],
  "yourStack": "paragraph comparing user's current model to landscape",
  "upgradeSuggestion": "optional suggestion or null",
  "upgradeSlug": "slug of suggested model or null",
  "headlineNewsId": "optional exact news id or null",
  "breakingNewsIds": ["optional exact news ids"]
}

Context:
${JSON.stringify(compact)}

Be concise, factual, and actionable. Use only numbers, prices, model slugs, licenses, and news IDs supplied in Context. A null price means not published; do not turn it into zero. Do not call a model open source unless the supplied license/accessibility explicitly says so; unknown is unknown.
The deterministic application validates leader, new-model stats, prices, licenses, and upgradeSlug. Keep those fields grounded. You may select headlineNewsId/breakingNewsIds only from Context.diff.topNews, and may write a short clearly AI-authored comment in headline/breaking around those exact titles.
If upgradeCandidates include a "missing a … role" reason, prioritize telling the user which stack role they lack and the SOTA pick. Do not claim that a model is compatible with a particular client or endpoint unless Context explicitly provides that fact.`;
}

export function buildAiPickPrompt(
  period: NewsPeriod,
  items: { id: string; title: string; source: string; score: number; summary: string }[],
): string {
  const compact = items.slice(0, 20).map((item) => ({ id: item.id, title: item.title.slice(0, 180), source: item.source.slice(0, 80), score: item.score, summary: item.summary.slice(0, 120) }));
  return `You are AI Pulse news curator. From the candidate stories for period "${period}", pick the most groundbreaking AI news only. Use English for reasons.

Groundbreaking means: major model launches, frontier capability jumps, significant lab breakthroughs, important benchmark SOTA shifts, or consequential policy/safety events. Skip routine tutorials, minor tool roundups, and recycled hype.

Return ONLY valid JSON:
{
  "picks": [
    { "id": "exact-id-from-candidates", "reason": "one short line why this is groundbreaking" }
  ]
}

Pick at most 8 items. Prefer primary lab sources when stories overlap. Use only IDs from the candidate list.

Candidates:
${JSON.stringify(compact)}`;
}

export function buildBatchedAiPickPrompt(
  byPeriod: Record<string, { id: string; title: string; source: string; score: number; summary: string }[]>,
): string {
  const seen = new Set<string>();
  const items: { id: string; title: string; source: string; score: number; summary: string }[] = [];
  const membership: Record<string, string[]> = {};
  for (const [period, periodItems] of Object.entries(byPeriod)) {
    membership[period] = [];
    for (const item of periodItems) {
      membership[period].push(item.id);
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (items.length < 20) items.push({ ...item, title: item.title.slice(0, 180), source: item.source.slice(0, 80), summary: item.summary.slice(0, 120) });
    }
  }
  const available = new Set(items.map((item) => item.id));
  for (const period of Object.keys(membership)) membership[period] = membership[period].filter((id) => available.has(id));
  return `You are AI Pulse news curator. For each time period, pick the most groundbreaking AI news only. Use English for reasons.

Groundbreaking means: major model launches, frontier capability jumps, significant lab breakthroughs, important benchmark SOTA shifts, or consequential policy/safety events. Skip routine tutorials, minor tool roundups, and recycled hype.

Return ONLY valid JSON:
{
  "periods": {
    "hour": { "picks": [{ "id": "exact-id", "reason": "short why" }] },
    "12h": { "picks": [] },
    "today": { "picks": [] },
    "week": { "picks": [] },
    "month": { "picks": [] }
  }
}

For each period: at most 5 picks, use only IDs listed for that period in membership. Empty picks arrays are valid and must remain empty when nothing is groundbreaking. Never invent an ID or repeat a story unnecessarily.

Unique candidates (each story appears once):
${JSON.stringify(items)}
Membership by period:
${JSON.stringify(membership)}`;
}

export function buildRulesAiPicks(
  items: NewsItem[],
  limit = 8,
): { id: string; reason: string }[] {
  return items
    .filter((n) => n.relevanceScore >= 70 || n.category === "releases" || n.category === "benchmarks")
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      reason:
        n.category === "releases"
          ? "Notable release or launch signal"
          : n.category === "benchmarks"
            ? "Benchmark / leaderboard movement"
            : "High-relevance AI development",
    }));
}

export function buildRulesBriefing(context: {
  diff: {
    newModelSlugs: string[];
    leaderChanges: string[];
    topNews: { title: string; source: string; score: number }[];
  };
  topModels: ModelRecord[];
  profile: MyStackProfile;
  upgradeCandidates: UpgradeCandidate[];
}): {
  headline: string;
  breaking: string[];
  watchList: string[];
  newModels: string[];
  yourStack: string;
  upgradeSuggestion: string | null;
  upgradeSlug: string | null;
} {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");
  const ROLE_NAMES: Record<string, string> = {
    primary: "Primary",
    secondary: "Budget",
    free: "Free",
  };

  const leader = context.topModels[0];
  const headline = leader
    ? `${leader.name} leads intelligence (${fmt(leader.intelligence)}). ${context.diff.newModelSlugs.length} new model(s) tracked.`
    : "AI Pulse is monitoring the model landscape.";

  const breaking = context.diff.topNews.slice(0, 3).map((n) => `${n.title} (${n.source})`);
  const watchList: string[] = [];
  if (context.diff.leaderChanges.length > 0) {
    watchList.push(`Leader changes: ${context.diff.leaderChanges.join(", ")}`);
  }
  watchList.push("Benchmark data refreshes every 2 hours from Artificial Analysis.");

  const newModels = context.diff.newModelSlugs
    .map((slug) => {
      const m = context.topModels.find((x) => x.slug === slug);
      return m ? `${m.name} — intel ${fmt(m.intelligence)}, ${m.priceBlended === null ? "price n/a" : `$${m.priceBlended.toFixed(2)}/1M`}` : slug;
    })
    .slice(0, 5);

  const entries = (context.profile.entries ?? []).filter((e) => e.modelSlug);
  const yourStack = entries.length
    ? entries
        .map((e) => {
          const role = ROLE_NAMES[e.role] ?? e.role;
          const areas = (e.areas ?? []).join(", ") || "general";
          const providers = (e.providers ?? []).join(", ") || "?";
          return `${role}: ${e.modelName} · ${areas} · ${providers}`;
        })
        .join("\n")
    : `No models in My Stack yet. Top model: ${leader?.name ?? "unknown"} (intel ${leader ? fmt(leader.intelligence) : "—"}).`;

  const best = context.upgradeCandidates[0];
  const gap = context.upgradeCandidates.find((c) => /missing a/i.test(c.reason));
  const pick = gap ?? best;
  const upgradeSuggestion = pick ? pick.reason : null;

  return {
    headline,
    breaking,
    watchList,
    newModels,
    yourStack,
    upgradeSuggestion,
    upgradeSlug: pick?.slug ?? null,
  };
}
