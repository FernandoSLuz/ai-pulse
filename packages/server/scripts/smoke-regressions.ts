import assert from "node:assert/strict";
import { mergeBenchmarkModels } from "../src/fetchers/merge-models.js";
import { collapseVariants } from "../src/collapse-variants.js";
import { enrichAccessibility } from "../src/fetchers/huggingface-access.js";
import { computeWinners } from "../src/rankings.js";
import { fetchAaPublicSiteModels } from "../src/fetchers/aa-public-site.js";
import type { ModelRecord } from "../src/types.js";

function model(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    slug: "example", name: "Example", creator: "Unknown", intelligence: 50, coding: 0, math: 0,
    priceInput: null, priceOutput: null, priceBlended: null, speed: 0, latency: 0,
    accessibility: "Unknown", accessibilityScore: 0, fetchedAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

// Missing pricing remains missing; it never turns into $0/free during merge.
const missingPrice = mergeBenchmarkModels([model({ priceInput: null, priceOutput: null, priceBlended: null })], [model({ priceInput: null, priceOutput: null, priceBlended: null })]);
assert.equal(missingPrice[0].priceBlended, null);
const free = mergeBenchmarkModels([model({ priceBlended: null })], [model({ priceBlended: 0, priceInput: 0, priceOutput: 0 })]);
assert.equal(free[0].priceBlended, 0, "published free must remain zero, not missing");

// A real pair of prices uses AA's documented 3:1 blend.
const priced = mergeBenchmarkModels([model({ priceInput: 1, priceOutput: 5, priceBlended: null })], []);
assert.equal(priced[0].priceBlended, null, "merge must not invent a price when only one source row exists");
const enriched = mergeBenchmarkModels([model({ priceInput: 1, priceOutput: 5, priceBlended: null })], [model({ priceInput: 1, priceOutput: 5, priceBlended: 2 })]);
assert.equal(enriched[0].priceBlended, 2);
const publicTuple = mergeBenchmarkModels(
  [model({ priceInput: 1, priceOutput: 5, priceBlended: 2, accessibility: "Unknown", accessibilityScore: 0, priceSourceUrl: "api" })],
  [model({ priceInput: null, priceOutput: null, priceBlended: 2.5, accessibility: "Open weights", accessibilityScore: 4, weightsUrl: "site-weights", priceSourceUrl: "site" })],
)[0];
assert.equal(publicTuple.priceInput, null, "pricing must not mix API input with public blend");
assert.equal(publicTuple.priceOutput, null, "pricing must not mix API output with public blend");
assert.equal(publicTuple.priceBlended, 2.5);
assert.equal(publicTuple.accessibility, "Open weights");
assert.equal(publicTuple.weightsUrl, "site-weights");
const variantsWithPrices = mergeBenchmarkModels(
  [model({ slug: "demo-a", priceBlended: 1 }), model({ slug: "demo-b", priceBlended: 9 })],
  [model({ slug: "demo-a", priceBlended: 2 })],
);
assert.equal(variantsWithPrices.find((m) => m.slug === "demo-a")?.priceBlended, 2);
assert.equal(variantsWithPrices.find((m) => m.slug === "demo-b")?.priceBlended, 9);

// Open weights are not silently promoted to open source.
const weights = model({ accessibility: "Open weights", accessibilityScore: 4 });
assert.notEqual(weights.accessibility, "Open source");

// Effort variants collapse for presentation, while SQLite/source slugs remain distinct.
const variants = collapseVariants([
  model({ slug: "demo-high", name: "Demo (High Effort)", intelligence: 80 }),
  model({ slug: "demo-low", name: "Demo (Low Effort)", intelligence: 79 }),
]);
assert.equal(variants.models.length, 1);
assert.equal(variants.variantsCollapsed, 1);
assert.equal(Object.keys(variants.variantAliases).length, 1);

const winners = computeWinners([
  model({ slug: "free", priceBlended: 0 }),
  model({ slug: "paid", priceBlended: 1 }),
]);
assert.equal(winners.price, "free", "published free price zero is a valid winner");

// AA sends family metadata and metric rows separately. Metric names must win
// so effort/settings variants survive into the slug-level store.
const oldAaFetch = globalThis.fetch;
const aaFixture = [
  JSON.stringify({ slug: "family-max", name: "Family (Max)", intelligenceIndex: 90, price1mInputTokens: 1, price1mOutputTokens: 2 }),
  JSON.stringify({ slug: "family-xhigh", shortName: "Family (XHigh)", intelligenceIndex: 89, price1mInputTokens: 1, price1mOutputTokens: 2 }),
  JSON.stringify({ slug: "family-high", name: "Family (High)", intelligenceIndex: 88, price1mInputTokens: 1, price1mOutputTokens: 2 }),
  JSON.stringify({ slug: "family-max", name: "Family", creator: { name: "Vendor" }, releaseDate: "2026-10-01" }),
  JSON.stringify({ slug: "family-xhigh", name: "Family", creator: { name: "Vendor" }, releaseDate: "2026-10-01" }),
  JSON.stringify({ slug: "family-high", name: "Family", creator: { name: "Vendor" }, releaseDate: "2026-10-01" }),
].join("\n");
globalThis.fetch = (async () => new Response(aaFixture, { status: 200 })) as typeof fetch;
const aaVariants = await fetchAaPublicSiteModels();
assert.deepEqual(new Map(aaVariants.map((m) => [m.slug, m.name])), new Map([
  ["family-max", "Family (Max)"],
  ["family-xhigh", "Family (XHigh)"],
  ["family-high", "Family (High)"],
]));
globalThis.fetch = oldAaFetch;

// An arbitrary third-party Apache repository is not provenance.
const oldFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL) => {
  if (String(input).includes("api/models?")) return new Response(JSON.stringify([{ id: "org/example", pipeline_tag: "text-generation" }]));
  return new Response(JSON.stringify({ id: "org/example", cardData: { license: "apache-2.0" }, gated: false }));
}) as typeof fetch;
const noLicense = model({ slug: "example", creator: "Unknown" });
await enrichAccessibility([noLicense], 1);
assert.equal(noLicense.accessibility, "Unknown");
assert.equal(noLicense.license, undefined);
// A verified publisher with a restrictive/custom license is still weights,
// while the license remains visible evidence.
globalThis.fetch = (async (input: string | URL) => {
  if (String(input).includes("api/models?")) return new Response(JSON.stringify([{ id: "meta-llama/llama-3-8b", pipeline_tag: "text-generation" }]));
  return new Response(JSON.stringify({ id: "meta-llama/llama-3-8b", cardData: { license: "llama3.1" }, gated: false }));
}) as typeof fetch;
const restricted = model({ slug: "llama-3-8b", creator: "Meta" });
await enrichAccessibility([restricted], 1);
assert.equal(restricted.accessibility, "Open weights");
assert.equal(restricted.license, "llama3.1");
globalThis.fetch = (async (input: string | URL) => {
  if (String(input).includes("api/models?")) return new Response(JSON.stringify([{ id: "meta-llama/llama-3-8b", pipeline_tag: "text-generation" }]));
  return new Response(JSON.stringify({ id: "meta-llama/llama-3-8b", cardData: { license: "not a license" }, gated: false }));
}) as typeof fetch;
const malformed = model({ slug: "llama-3-8b", creator: "Meta" });
await enrichAccessibility([malformed], 1);
assert.equal(malformed.license, null);
globalThis.fetch = (async (input: string | URL) => {
  if (String(input).includes("api/models?")) return new Response(JSON.stringify([{ id: "google/gemma-3-1b-it", pipeline_tag: "text-generation" }]));
  return new Response(JSON.stringify({ id: "google/gemma-3-1b-it", cardData: { license: "gemma" }, gated: false }));
}) as typeof fetch;
const nearVariant = model({ slug: "gemma-3-1b", creator: "Google" });
await enrichAccessibility([nearVariant], 1);
assert.equal(nearVariant.accessibility, "Unknown", "near-variant repo must not prove provenance");
globalThis.fetch = oldFetch;

console.log("benchmark smoke regressions: OK");
