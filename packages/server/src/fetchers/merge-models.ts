import type { ModelRecord } from "../types.js";

function completeness(m: ModelRecord): number {
  let score = 0;
  if (m.intelligence > 0) score += 10;
  if (m.coding > 0) score += 5;
  if (m.math > 0) score += 5;
  if (m.priceBlended > 0 || m.priceInput > 0) score += 4;
  if (m.speed > 0) score += 4;
  if (m.latency > 0) score += 1;
  if (m.creator && m.creator !== "Unknown") score += 1;
  return score;
}

function preferPositive(a: number, b: number): number {
  if (a > 0 && b > 0) return a;
  return a > 0 ? a : b;
}

/**
 * Field-wise merge: keep non-zero metrics from both sides.
 * `preferred` wins when both have a value.
 */
function mergePair(preferred: ModelRecord, other: ModelRecord): ModelRecord {
  const priceInput = preferPositive(preferred.priceInput, other.priceInput);
  const priceOutput = preferPositive(preferred.priceOutput, other.priceOutput);
  let priceBlended = preferPositive(preferred.priceBlended, other.priceBlended);
  if (!priceBlended && (priceInput || priceOutput)) {
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
    accessibility: preferred.accessibility || other.accessibility,
    accessibilityScore: preferred.accessibilityScore || other.accessibilityScore,
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
    const merged = mergePair(preferred, other);
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
  const withPrice = merged.filter((m) => m.priceBlended > 0).length;
  console.log(
    `[AA Merge] ${merged.length} models (+${added} site, enriched ${enriched}) ` +
      `(coding=${withCoding}, math=${withMath}, speed=${withSpeed}, price=${withPrice})`,
  );
  return merged;
}
