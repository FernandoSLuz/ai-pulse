import type { ModelRecord } from "../types.js";

function completeness(m: ModelRecord): number {
  let score = 0;
  if (m.intelligence > 0) score += 10;
  if (m.coding > 0) score += 5;
  if (m.math > 0) score += 5;
  if ((m.priceBlended ?? 0) > 0 || (m.priceInput ?? 0) > 0) score += 4;
  if (m.speed > 0) score += 4;
  if (m.latency > 0) score += 1;
  if (m.creator && m.creator !== "Unknown") score += 1;
  return score;
}

function preferPositive(a: number, b: number): number {
  if (a !== null && a > 0) return a;
  if (b !== null && b > 0) return b;
  return a ?? b;
}

function preferPrice(a: number | null, b: number | null): number | null {
  // Zero is a real published free price; only null means unavailable.
  if (a !== null) return a;
  if (b !== null) return b;
  return a ?? b;
}

/**
 * Field-wise merge: keep non-zero metrics from both sides.
 * `preferred` wins when both have a value.
 */
function mergePair(preferred: ModelRecord, other: ModelRecord, publicSite: ModelRecord, api: ModelRecord): ModelRecord {
  // Pricing is a coherent source tuple. The public leaderboard wins whenever
  // it publishes any pricing field; API pricing is used only as a complete
  // fallback, never mixed input/output/blended across sources.
  const pricing = [publicSite, api].find((m) => m === publicSite
    ? m.priceInput !== null || m.priceOutput !== null || m.priceBlended !== null
    : m.priceInput !== null || m.priceOutput !== null || m.priceBlended !== null) ?? publicSite;
  const priceInput = pricing.priceInput;
  const priceOutput = pricing.priceOutput;
  let priceBlended = pricing.priceBlended;
  if (priceBlended === null && priceInput !== null && priceOutput !== null) {
    priceBlended = priceInput * 0.75 + priceOutput * 0.25;
  }

  return {
    ...preferred,
    name: preferred.name || other.name,
    creator:
      preferred.creator && preferred.creator !== "Unknown" ? preferred.creator : other.creator,
    intelligence: preferPositive(preferred.intelligence, other.intelligence),
    coding: preferPositive(preferred.coding, other.coding),
    math: preferPositive(preferred.math, other.math),
    priceInput,
    priceOutput,
    priceBlended,
    speed: preferPositive(preferred.speed, other.speed),
    latency: preferPositive(preferred.latency, other.latency),
    accessibility: preferred.accessibilityScore >= other.accessibilityScore ? preferred.accessibility : other.accessibility,
    accessibilityScore: Math.max(preferred.accessibilityScore, other.accessibilityScore),
    license: preferred.accessibilityScore >= other.accessibilityScore ? preferred.license ?? null : other.license ?? null,
    licenseUrl: preferred.accessibilityScore >= other.accessibilityScore ? preferred.licenseUrl ?? null : other.licenseUrl ?? null,
    weightsUrl: preferred.accessibilityScore >= other.accessibilityScore ? preferred.weightsUrl ?? null : other.weightsUrl ?? null,
    priceSourceUrl: pricing.priceSourceUrl ?? null,
    url: preferred.url || other.url,
    fetchedAt: preferred.fetchedAt || other.fetchedAt,
  };
}

/**
 * Merge free-API + public-site models by slug only (no fuzzy name collapse —
 * variants like Opus 4.8 max vs default must stay separate).
 * Public-site rows are preferred when richer.
 */
export function mergeBenchmarkModels(
  apiModels: ModelRecord[],
  siteModels: ModelRecord[],
): ModelRecord[] {
  if (!siteModels.length) return apiModels;
  if (!apiModels.length) return siteModels;

  const bySlug = new Map<string, ModelRecord>();

  for (const m of apiModels) {
    bySlug.set(m.slug, m);
  }

  let enriched = 0;
  let added = 0;

  for (const s of siteModels) {
    const existing = bySlug.get(s.slug);
    if (!existing) {
      bySlug.set(s.slug, s);
      added++;
      continue;
    }
    const preferred = completeness(s) >= completeness(existing) ? s : existing;
    const other = preferred === s ? existing : s;
    const merged = mergePair(preferred, other, s, existing);
    bySlug.set(s.slug, merged);
    if (
      merged.coding !== existing.coding ||
      merged.speed !== existing.speed ||
      merged.priceBlended !== existing.priceBlended ||
      merged.math !== existing.math
    ) {
      enriched++;
    }
  }

  const merged = [...bySlug.values()];
  const withSpeed = merged.filter((m) => m.speed > 0).length;
  const withCoding = merged.filter((m) => m.coding > 0).length;
  const withMath = merged.filter((m) => m.math > 0).length;
  const withPrice = merged.filter((m) => (m.priceBlended ?? 0) > 0).length;
  console.log(
    `[AA Merge] ${merged.length} models (+${added} site, enriched ${enriched}) ` +
      `(coding=${withCoding}, math=${withMath}, speed=${withSpeed}, price=${withPrice})`,
  );
  return merged;
}
