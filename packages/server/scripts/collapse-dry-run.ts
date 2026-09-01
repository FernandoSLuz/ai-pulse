// P4a dry-run: READ-ONLY inspection of data/ai-pulse.db to preview variant
// collapsing. Never writes, never deletes. Run from packages/server:
//   npx tsx scripts/collapse-dry-run.ts
// Human gate 3: no grouping ships without Fernando approving this report item
// by item (exceptions become NEVER_COLLAPSE entries in collapse-variants.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  NEVER_COLLAPSE,
  collapseVariants,
  normalizeVariantKey,
} from "../src/collapse-variants.js";
import type { ModelRecord } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data", "ai-pulse.db");

interface CheckpointFailure {
  test: string;
  detail: string;
}

const failures: CheckpointFailure[] = [];

function assertCheckpoint(condition: boolean, test: string, detail: string): void {
  if (!condition) failures.push({ test, detail });
}

// --- Smoke tests on normalizeVariantKey / collapseVariants with literal inputs
// (independent of DB contents). ---

// (a) effort qualifiers inside parentheses collapse to the same group
const keyA1 = normalizeVariantKey("Claude Opus 4.6 (Non-reasoning, High Effort)");
const keyA2 = normalizeVariantKey("Claude Opus 4.6 (Adaptive Reasoning, Max Effort)");
assertCheckpoint(keyA1 === keyA2, "(a) effort qualifiers collapse", `"${keyA1}" !== "${keyA2}"`);

// (b) non-vocabulary suffixes keep groups DIFFERENT by construction
const keyB1 = normalizeVariantKey("GPT-5.6 Sol (max)");
const keyB2 = normalizeVariantKey("GPT-5.6 Terra (xhigh)");
assertCheckpoint(keyB1 !== keyB2, "(b) Sol vs Terra stay separate", `"${keyB1}" === "${keyB2}"`);

// (c) date checkpoints stay separate (apostrophes in month qualifiers)
const keyC1 = normalizeVariantKey("Claude 3.5 Sonnet (June '24)");
const keyC2 = normalizeVariantKey("Claude 3.5 Sonnet (Oct '24)");
assertCheckpoint(keyC1 !== keyC2, "(c) date checkpoints stay separate", `"${keyC1}" === "${keyC2}"`);

// --- DB report ---

if (!fs.existsSync(dbPath)) {
  console.error(`[dry-run] DB not found at ${dbPath} — aborting (read-only; nothing created).`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    "SELECT slug, name, creator, intelligence, coding, math, price_input, price_output, price_blended, speed, latency, accessibility, accessibility_score, fetched_at FROM models",
  )
  .all() as Record<string, unknown>[];
db.close();

const models: ModelRecord[] = rows.map((row) => ({
  slug: row.slug as string,
  name: row.name as string,
  creator: (row.creator as string) ?? "",
  intelligence: (row.intelligence as number) ?? 0,
  coding: (row.coding as number) ?? 0,
  math: (row.math as number) ?? 0,
  priceInput: (row.price_input as number) ?? 0,
  priceOutput: (row.price_output as number) ?? 0,
  priceBlended: (row.price_blended as number) ?? 0,
  speed: (row.speed as number) ?? 0,
  latency: (row.latency as number) ?? 0,
  accessibility: (row.accessibility as string) ?? "Unknown",
  accessibilityScore: (row.accessibility_score as number) ?? 0,
  fetchedAt: (row.fetched_at as string) ?? "",
}));

console.log(`[dry-run] ${models.length} models loaded (read-only) from ${dbPath}\n`);

const groups = new Map<string, ModelRecord[]>();
for (const model of models) {
  const key = normalizeVariantKey(model.name);
  const bucket = groups.get(key);
  if (bucket) bucket.push(model);
  else groups.set(key, [model]);
}

const multiGroups = [...groups.entries()].filter(([, members]) => members.length > 1);

for (const [key, members] of multiGroups) {
  console.log(`GROUP KEY: ${key}`);
  const winner = collapseVariants(members).models[0];
  const previewTouched = members.some((m) => /preview/i.test(m.name));
  for (const m of members) {
    const mark = m.slug === winner.slug ? "*" : " ";
    const price = m.priceBlended > 0 ? m.priceBlended.toFixed(2) : "inf";
    console.log(
      ` ${mark} ${m.slug} | ${m.name} | intel=${m.intelligence} coding=${m.coding} price=${price}`,
    );
  }
  if (previewTouched) {
    console.log(
      "  !! group formed (partly) by removing 'preview' — release-channel marker, review at gate 3",
    );
  }
  console.log("");
}

const collapsed = multiGroups.reduce((sum, [, members]) => sum + members.length - 1, 0);
console.log("--- totals ---");
console.log(`multi-member groups : ${multiGroups.length}`);
console.log(`variants collapsed  : ${collapsed}`);
console.log(`singletons          : ${models.length - collapsed}`);
console.log(`NEVER_COLLAPSE      : ${JSON.stringify(NEVER_COLLAPSE)}`);

if (failures.length > 0) {
  console.error("\n[dry-run] SMOKE TEST FAILURES:");
  for (const f of failures) console.error(`  ${f.test}: ${f.detail}`);
  process.exit(1);
}
console.log("\n[dry-run] smoke tests (a)-(c) passed.");
