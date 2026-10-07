import type { CategoryWinners, ModelRecord, RankingsSnapshot } from "./types.js";
import { collapseVariants } from "./collapse-variants.js";
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

  // A category with no data must not crown whoever happens to sort first (AA's
  // public leaderboard stopped publishing the coding/math composites, so those
  // columns are legitimately empty until a keyed AA_API_KEY enriches them).
  const topBy = (score: (m: ModelRecord) => number | null, dir: "desc" | "asc" = "desc", allowZero = false): string => {
    let best: ModelRecord | null = null;
    for (const m of models) {
      const value = score(m);
      if (value === null || !Number.isFinite(value) || value < 0 || (value === 0 && !allowZero)) continue;
      if (!best || (dir === "desc" ? value > score(best)! : value < score(best)!)) best = m;
    }
    return best?.slug ?? "";
  };

  return {
    overall: topBy((m) => m.intelligence),
    coding: topBy((m) => m.coding),
    math: topBy((m) => m.math),
    price: topBy((m) => m.priceBlended, "asc", true),
    speed: topBy((m) => m.speed),
    accessibility: topBy((m) => m.accessibilityScore),
  };
}

export function buildRankingsSnapshot(
  models: ModelRecord[],
  configuredPollMs = Number(process.env.AA_POLL_INTERVAL_MS) || DEFAULT_POLL_MS,
): RankingsSnapshot {
  const sorted = [...models].sort((a, b) => b.intelligence - a.intelligence);
  const collapsed = collapseVariants(sorted);
  const visible = collapsed.models;
  const health = evaluatePollHealth(configuredPollMs);
  const updatedAt = getLastPollAt();
  return {
    models: withModelLinks(visible),
    winners: computeWinners(visible),
    testedModels: withModelLinks(sorted),
    testedWinners: computeWinners(sorted),
    updatedAt,
    variantAliases: collapsed.variantAliases,
    variantsCollapsed: collapsed.variantsCollapsed,
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
