import type { CategoryWinners, ModelRecord, RankingsSnapshot } from "./types.js";
import { getMeta, setMeta } from "./db.js";
import { withModelLinks } from "./model-links.js";
import { evaluatePollHealth, getLastPollAt } from "./poll-health.js";

const DEFAULT_POLL_MS = 7_200_000;

export function computeBlendedPrice(input: number, output: number): number {
  return input * 0.75 + output * 0.25;
}

export function computeWinners(models: ModelRecord[]): CategoryWinners {
  if (models.length === 0) {
    return { overall: "", coding: "", math: "", price: "", speed: "", accessibility: "" };
  }

  const byIntelligence = [...models].sort((a, b) => b.intelligence - a.intelligence);
  const byCoding = [...models].sort((a, b) => b.coding - a.coding);
  const byMath = [...models].sort((a, b) => b.math - a.math);
  const byPrice = [...models].filter((m) => m.priceBlended > 0).sort((a, b) => a.priceBlended - b.priceBlended);
  const bySpeed = [...models].sort((a, b) => b.speed - a.speed);
  const byAccess = [...models].sort((a, b) => b.accessibilityScore - a.accessibilityScore);

  return {
    overall: byIntelligence[0]?.slug ?? "",
    coding: byCoding[0]?.slug ?? "",
    math: byMath[0]?.slug ?? "",
    price: byPrice[0]?.slug ?? "",
    speed: bySpeed[0]?.slug ?? "",
    accessibility: byAccess[0]?.slug ?? "",
  };
}

export function buildRankingsSnapshot(
  models: ModelRecord[],
  configuredPollMs = Number(process.env.AA_POLL_INTERVAL_MS) || DEFAULT_POLL_MS,
): RankingsSnapshot {
  const sorted = [...models].sort((a, b) => b.intelligence - a.intelligence);
  const health = evaluatePollHealth(configuredPollMs);
  const updatedAt = getLastPollAt() ?? new Date().toISOString();
  return {
    models: withModelLinks(sorted),
    winners: computeWinners(sorted),
    updatedAt,
    health: {
      stale: health.stale,
      warning: health.warning,
      averageIntervalMs: health.averageIntervalMs,
      ageMs: health.ageMs,
    },
  };
}

export function detectLeaderChanges(newWinners: CategoryWinners): string[] {
  const prev = getMeta("last_winners");
  if (!prev) {
    setMeta("last_winners", JSON.stringify(newWinners));
    return [];
  }

  const old = JSON.parse(prev) as CategoryWinners;
  const changes: string[] = [];
  const categories: (keyof CategoryWinners)[] = ["overall", "coding", "math", "price", "speed", "accessibility"];

  for (const cat of categories) {
    if (old[cat] && newWinners[cat] && old[cat] !== newWinners[cat]) {
      changes.push(`${cat}:${newWinners[cat]}`);
    }
  }

  setMeta("last_winners", JSON.stringify(newWinners));
  return changes;
}

export function modelDisplayRank(models: ModelRecord[], slug: string): number {
  const idx = models.findIndex((m) => m.slug === slug);
  return idx >= 0 ? idx + 1 : -1;
}
