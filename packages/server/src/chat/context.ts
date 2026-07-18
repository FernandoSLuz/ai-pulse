import { getAllModels, getLatestBriefing, getMyStack, getNews } from "../db.js";
import { buildRankingsSnapshot } from "../rankings.js";

export function buildPulseSystemPrompt(searchEnabled: boolean): string {
  const models = getAllModels();
  const snapshot = buildRankingsSnapshot(models);
  const news = getNews(10, "all", "week", "all");
  const briefing = getLatestBriefing();
  const stack = getMyStack();

  const bySlug = new Map(snapshot.models.map((m) => [m.slug, m]));
  const winnerLines = Object.entries(snapshot.winners)
    .filter(([, slug]) => slug)
    .map(([cat, slug]) => {
      const m = bySlug.get(slug);
      return `- ${cat}: ${m?.name ?? slug}${m ? ` (intel ${m.intelligence.toFixed(1)})` : ""}`;
    });

  const topRows = snapshot.models.slice(0, 12).map((m, i) => {
    const price = m.priceBlended > 0 ? `$${m.priceBlended.toFixed(2)}` : "free/n/a";
    return `${i + 1}. ${m.name} (${m.creator}) — intel ${m.intelligence.toFixed(1)}, code ${m.coding.toFixed(1)}, price ${price}, speed ${m.speed.toFixed(0)}`;
  });

  const newsLines = news.map(
    (n) => `- [${n.source}] ${n.title} (score ${Math.round(n.relevanceScore)})`,
  );

  const stackLines =
    stack.entries.length === 0
      ? ["(no models in My Stack yet)"]
      : stack.entries.map(
          (e) =>
            `- ${e.role}: ${e.modelName || e.modelSlug || "(empty)"} via ${(e.providers ?? []).join(", ") || "n/a"}`,
        );

  const briefingBlock = briefing
    ? `Headline: ${briefing.headline}
Breaking: ${briefing.breaking.join("; ") || "none"}
Watch: ${briefing.watchList.join("; ") || "none"}
Your stack note: ${briefing.yourStack || "n/a"}
Upgrade: ${briefing.upgradeSuggestion || "none"}`
    : "(no briefing cached yet)";

  const toolsHint = searchEnabled
    ? `You have tools:
- query_pulse: look up live AI Pulse data (rankings, news, stack, briefing). Use for questions about this dashboard's data.
- web_search: search the live web via the search agent. Use for broader/current-events questions beyond Pulse data.
Prefer query_pulse for local Pulse questions. Use web_search when you need up-to-date external info. Cite sources with titles/URLs when you used web_search.`
    : `You have tools:
- query_pulse: look up live AI Pulse data (rankings, news, stack, briefing).
Web search is not configured. Answer broader questions from knowledge and Pulse data; say if live web search would help.`;

  return `You are AI Pulse Assistant — a helpful analyst for a local AI news + benchmark dashboard.

${toolsHint}

Be concise and practical. Prefer facts from tools/context over guessing.

## Latest briefing
${briefingBlock}

## Category winners
${winnerLines.join("\n") || "(none)"}

## Top models (by intelligence)
${topRows.join("\n") || "(no models)"}

## Recent news (this week)
${newsLines.join("\n") || "(no news)"}

## My Stack
${stackLines.join("\n")}`;
}

export function runQueryPulse(args: {
  topic?: string;
  limit?: number;
}): string {
  const topic = (args.topic ?? "all").toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
  const models = getAllModels();
  const snapshot = buildRankingsSnapshot(models);
  const stack = getMyStack();
  const briefing = getLatestBriefing();

  if (topic.includes("stack") || topic.includes("upgrade")) {
    return JSON.stringify(
      {
        entries: stack.entries.map((e) => ({
          role: e.role,
          model: e.modelName || e.modelSlug,
          providers: e.providers,
          suggestedUpgrade: e.suggestedUpgradeSlug,
        })),
        roleGaps: stack.roleGaps,
        briefingUpgrade: briefing?.upgradeSuggestion ?? null,
      },
      null,
      2,
    );
  }

  if (topic.includes("brief") || topic.includes("analyst")) {
    return JSON.stringify(briefing, null, 2);
  }

  if (topic.includes("news") || topic.includes("release") || topic.includes("headline")) {
    const items = getNews(limit, "all", "week", "all").map((n) => ({
      title: n.title,
      source: n.source,
      link: n.link,
      score: n.relevanceScore,
      category: n.category,
      publishedAt: n.publishedAt,
    }));
    return JSON.stringify({ news: items }, null, 2);
  }

  if (topic.includes("rank") || topic.includes("bench") || topic.includes("leader") || topic.includes("model")) {
    const bySlug = new Map(snapshot.models.map((m) => [m.slug, m]));
    const winners = Object.fromEntries(
      Object.entries(snapshot.winners).map(([cat, slug]) => [
        cat,
        bySlug.get(slug)?.name ?? slug,
      ]),
    );
    const top = snapshot.models.slice(0, limit).map((m) => ({
      name: m.name,
      creator: m.creator,
      intelligence: m.intelligence,
      coding: m.coding,
      math: m.math,
      priceBlended: m.priceBlended,
      speed: m.speed,
      accessibility: m.accessibility,
    }));
    return JSON.stringify({ winners, top, updatedAt: snapshot.updatedAt }, null, 2);
  }

  // default: compact overview
  const news = getNews(5, "all", "today", "all");
  return JSON.stringify(
    {
      briefingHeadline: briefing?.headline ?? null,
      winners: snapshot.winners,
      topModels: snapshot.models.slice(0, 5).map((m) => m.name),
      todayNews: news.map((n) => n.title),
      stackModels: stack.entries.map((e) => e.modelName || e.modelSlug).filter(Boolean),
    },
    null,
    2,
  );
}
