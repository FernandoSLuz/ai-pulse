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

  const topRows = snapshot.models.slice(0, 8).map((m, i) => {
    const price = m.priceBlended === null ? "price n/a" : `$${m.priceBlended.toFixed(2)}`;
    const license = m.license ? `, license ${m.license}` : ", license unknown";
    return `${i + 1}. ${m.name} (${m.creator}) — slug ${m.slug}, intel ${m.intelligence.toFixed(1)}, code ${m.coding.toFixed(1)}, price ${price}, speed ${m.speed.toFixed(0)}, access ${m.accessibility}${license}`;
  });

  const newsLines = news.slice(0, 8).map(
    (n) => `- ${n.id.slice(0, 8)} [${n.source}] ${n.title.slice(0, 160)} (score ${Math.round(n.relevanceScore)})`,
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
    ? "The supplied snapshot is the current AI Pulse data. An explicit web-search result may follow; cite its titles/URLs when present."
    : "The supplied snapshot is the current AI Pulse data. Web search is not configured; answer from this snapshot and general knowledge.";

  return `You are AI Pulse Assistant for a local AI news and benchmark dashboard. Default to English unless the user explicitly asks for another language.

${toolsHint}

Be concise and practical. Prefer facts from the supplied Pulse data. Never invent benchmark scores, prices, licenses, news, or upgrade slugs. A missing price is "price n/a"; $0.00 is a real zero. Treat accessibility/license as unknown unless explicitly supplied. Any AI commentary must be clearly framed as commentary, while dashboard facts stay exact.

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
