import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "ai-pulse-public-benchmarks-"));
process.env.AI_PULSE_DATA_DIR = dataDir;
const moduleUrl = new URL("../src/benchmarks/public-sources.js", import.meta.url).href;
const { getPublicBenchmarks, refreshPublicBenchmarks } = await import(moduleUrl);
const oldFetch = globalThis.fetch;
const oldNow = Date.now;
let mode: "valid" | "malformed" | "invalid" = "valid";

const categories = JSON.stringify({
  reasoning: ["reasoning_1"],
  coding: ["coding_1", "coding_2"],
});
const liveCsv = [
  "model,reasoning_1,coding_1,coding_2",
  "alpha,100,0,100",
  "blank,,0,100",
  "negative,80,-1,20",
].join("\n");
const swe = JSON.stringify({ leaderboards: [{ name: "Verified", results: [
  { folder: "agent-alpha", agent: "Agent Alpha", model_display: "Model A", resolved: 72, checked: true, date: "2026-10-01" },
  { folder: "agent-warning", agent: "Agent Warning", model_display: "Model B", resolved: 63, checked: false, warning: "submission warning", date: "2026-09-30" },
  { folder: "bad", agent: "Bad", model_display: "Bad", resolved: -1, date: "2026-10-02" },
] }] });

globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  if (mode === "invalid") return new Response("not json", { status: 200 });
  if (url.includes("constants.js")) return new Response("export const RELEASES = [\"2026-10-01\"];");
  if (url.includes("categories_2026_10_01")) return new Response(mode === "malformed" ? JSON.stringify({ reasoning: ["reasoning_1"], coding: "changed-schema" }) : categories);
  if (url.includes("table_2026_10_01")) return new Response(liveCsv);
  if (url.includes("leaderboards.json")) return new Response(swe);
  return new Response("missing fixture", { status: 404 });
}) as typeof fetch;

try {
  const initial = getPublicBenchmarks();
  assert.deepEqual(initial.boards.map((board) => board.id), ["livebench", "swe-bench-verified"]);
  await refreshPublicBenchmarks();

  const fresh = getPublicBenchmarks();
  const live = fresh.boards.find((board) => board.id === "livebench")!;
  assert.equal(live.sourceVersion, "2026-10-01");
  // Category-balanced: (100 + ((0 + 100) / 2)) / 2 = 75, unlike task mean 66.67.
  assert.equal(live.rows.find((row) => row.id === "alpha")?.score, 75);
  assert.equal(live.rows.find((row) => row.id === "blank")?.score, null);
  assert.equal(live.rows.find((row) => row.id === "negative")?.score, null);
  assert.equal(live.stale, false);

  const sweBoard = fresh.boards.find((board) => board.id === "swe-bench-verified")!;
  assert.equal(sweBoard.rows.length, 2);
  assert.equal(sweBoard.rows.find((row) => row.id === "agent-warning")?.warning, "submission warning");
  assert.equal(sweBoard.rows.find((row) => row.id === "agent-warning")?.status, "not marked checked");
  assert.equal(sweBoard.sourceUpdatedAt, "2026-10-01");

  const fetchedAt = live.fetchedAt;
  mode = "malformed";
  Date.now = () => oldNow() + 61_000;
  await refreshPublicBenchmarks();
  const failed = getPublicBenchmarks().boards.find((board) => board.id === "livebench")!;
  assert.equal(failed.fetchedAt, fetchedAt);
  assert.equal(failed.rows.length, 3);
  assert.equal(failed.stale, true);
  assert.ok(failed.error);
  Date.now = oldNow;

  const child = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `const m=await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(m.getPublicBenchmarks()));`], {
    cwd: process.cwd(),
    env: { ...process.env, AI_PULSE_DATA_DIR: dataDir },
  }).toString().trim();
  const restarted = JSON.parse(child) as { boards: Array<{ id: string; rows: unknown[]; fetchedAt: string | null }> };
  assert.equal(restarted.boards.find((board) => board.id === "livebench")?.rows.length, 3);
  assert.equal(restarted.boards.find((board) => board.id === "livebench")?.fetchedAt, fetchedAt);
} finally {
  Date.now = oldNow;
  globalThis.fetch = oldFetch;
  rmSync(dataDir, { recursive: true, force: true });
}

console.log("public benchmark sources smoke: OK");
