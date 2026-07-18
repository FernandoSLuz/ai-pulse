import type { ModelRecord, MyStackProfile, NewsItem, NewsPeriod, UpgradeCandidate } from "../types.js";

export function buildAnalystPrompt(context: {
  diff: {
    newModelSlugs: string[];
    leaderChanges: string[];
    topNews: { title: string; source: string; score: number }[];
  };
  topModels: ModelRecord[];
  profile: MyStackProfile;
  upgradeCandidates: UpgradeCandidate[];
}): string {
  return `You are AI Pulse analyst. Summarize the latest AI model landscape for a technical user.

Return ONLY valid JSON with this exact shape:
{
  "headline": "one line summary",
  "breaking": ["bullet 1", "bullet 2"],
  "watchList": ["thing to watch 1"],
  "newModels": ["model name with key stat"],
  "yourStack": "paragraph comparing user's current model to landscape",
  "upgradeSuggestion": "optional suggestion or null",
  "upgradeSlug": "slug of suggested model or null"
}

Context:
${JSON.stringify(context, null, 2)}

Be concise, factual, and actionable. Reference specific models and scores.
If upgradeCandidates include a "missing a … role" reason, prioritize telling the user which stack role they lack and the SOTA pick. For Free-role gaps, prefer open/local models they can wire into Cursor via Override OpenAI Base URL (Ollama etc.) for unlimited use, and mention that setup briefly.`;
}

export function buildAiPickPrompt(
  period: NewsPeriod,
  items: { id: string; title: string; source: string; score: number; summary: string }[],
): string {
  return `You are AI Pulse news curator. From the candidate stories for period "${period}", pick the most groundbreaking AI news only.

Groundbreaking means: major model launches, frontier capability jumps, significant lab breakthroughs, important benchmark SOTA shifts, or consequential policy/safety events. Skip routine tutorials, minor tool roundups, and recycled hype.

Return ONLY valid JSON:
{
  "picks": [
    { "id": "exact-id-from-candidates", "reason": "one short line why this is groundbreaking" }
  ]
}

Pick at most 8 items. Prefer primary lab sources when stories overlap. Use only IDs from the candidate list.

Candidates:
${JSON.stringify(items, null, 2)}`;
}

export function buildBatchedAiPickPrompt(
  byPeriod: Record<string, { id: string; title: string; source: string; score: number; summary: string }[]>,
): string {
  return `You are AI Pulse news curator. For each time period, pick the most groundbreaking AI news only.

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

For each period: at most 8 picks, use only IDs from that period's candidate list. Empty picks arrays are fine.

Candidates by period:
${JSON.stringify(byPeriod, null, 2)}`;
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
      return m ? `${m.name} — intel ${fmt(m.intelligence)}, $${m.priceBlended.toFixed(2)}/1M` : slug;
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
