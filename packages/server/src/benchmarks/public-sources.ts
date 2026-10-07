import { getMeta, setMeta } from "../db.js";

export interface PublicBoardColumn { key: string; label: string; }
export interface PublicBoardRow {
  id: string;
  name: string;
  score: number | null;
  values: Record<string, number | null>;
  url?: string;
  testedAt?: string;
  detail?: string;
  status?: string;
  warning?: string;
}
export interface PublicBoard {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  methodologyUrl: string;
  metricLabel: string;
  entityLabel?: string;
  sourceUpdatedLabel?: string;
  sourceVersion: string | null;
  columns: PublicBoardColumn[];
  rows: PublicBoardRow[];
  fetchedAt: string | null;
  sourceUpdatedAt: string | null;
  error: string | null;
  stale: boolean;
}
export interface PublicBenchmarks { boards: PublicBoard[]; }

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const REFRESH_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000;
const cache = new Map<string, PublicBoard>();
const hydrated = new Set<string>();
let refreshPromise: Promise<void> | null = null;
let lastRefreshMs = 0;
let timer: NodeJS.Timeout | undefined;
let generation = 0;
let stopped = false;
let activeController: AbortController | null = null;

const definitions = [
  {
    id: "livebench",
    name: "LiveBench",
    description: "Contamination-resistant objective language-model benchmark. Global score is the equally weighted mean of category means; missing categories remain unscored.",
    sourceUrl: "https://livebench.ai/",
    methodologyUrl: "https://raw.githubusercontent.com/LiveBench/new-livebench/main/src/Table/Averaging.js",
    kind: "live" as const,
  },
  {
    id: "swe-bench-verified",
    name: "SWE-bench Verified",
    description: "Official Verified leaderboard. Rows represent agent + model systems; warnings and checked status are retained in row details.",
    sourceUrl: "https://www.swebench.com/",
    methodologyUrl: "https://github.com/SWE-bench/SWE-bench",
    kind: "swe" as const,
  },
];

function emptyBoard(def: typeof definitions[number]): PublicBoard {
  return {
    id: def.id, name: def.name, description: def.description,
    sourceUrl: def.sourceUrl, methodologyUrl: def.methodologyUrl,
    metricLabel: def.kind === "live" ? "Global category-balanced score (%)" : "Resolved issues (%)",
    entityLabel: def.kind === "live" ? "Model" : "Agent + model",
    sourceUpdatedLabel: def.kind === "live" ? "Suite release" : "Latest submission",
    sourceVersion: null, columns: [], rows: [], fetchedAt: null,
    sourceUpdatedAt: null, error: null, stale: false,
  };
}
for (const def of definitions) cache.set(def.id, emptyBoard(def));

function metaKey(id: string): string { return `public_benchmark_${id}_snapshot_v2`; }
function finiteScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}
function validSnapshot(value: unknown): value is PublicBoard {
  if (!value || typeof value !== "object") return false;
  const b = value as PublicBoard;
  return typeof b.id === "string" && typeof b.name === "string" &&
    typeof b.description === "string" && typeof b.sourceUrl === "string" &&
    typeof b.methodologyUrl === "string" && typeof b.metricLabel === "string" &&
    Array.isArray(b.rows) && b.rows.every((row) => row && typeof row === "object" &&
      typeof (row as PublicBoardRow).id === "string" && typeof (row as PublicBoardRow).name === "string" &&
      (finiteScore((row as PublicBoardRow).score) !== null || (row as PublicBoardRow).score === null)) &&
    Array.isArray(b.columns) && b.columns.every((column) => column && typeof column.key === "string" && typeof column.label === "string") &&
    (b.fetchedAt === null || typeof b.fetchedAt === "string") &&
    (b.sourceUpdatedAt === null || typeof b.sourceUpdatedAt === "string") &&
    (b.error === null || typeof b.error === "string");
}
function hydrate(def: typeof definitions[number]): PublicBoard {
  const current = cache.get(def.id)!;
  if (!hydrated.has(def.id)) {
    const raw = getMeta(metaKey(def.id));
    if (raw) {
      try { const snapshot = JSON.parse(raw) as unknown; if (validSnapshot(snapshot) && snapshot.id === def.id) cache.set(def.id, snapshot); } catch { /* invalid cache stays ignored */ }
    }
    hydrated.add(def.id);
  }
  return cache.get(def.id) ?? current;
}

async function readLimited(response: Response, controller: AbortController): Promise<string> {
  if (!response.body) throw new Error("empty response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) { controller.abort(); await reader.cancel(); throw new Error("response exceeds 5 MB limit"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  try {
    const response = await fetch(url, { headers: { Accept: "application/json,text/csv,text/plain,*/*", "User-Agent": "AI-Pulse/2.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await readLimited(response, controller);
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", relay); }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseReleaseDates(source: string): string[] {
  const match = source.match(/RELEASES\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error("LiveBench RELEASES list missing");
  return [...match[1].matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]).filter((d) => !Number.isNaN(Date.parse(d)));
}

function categoryMean(row: Record<string, string>, tasks: string[]): number | null {
  const values = tasks.map((key) => {
    const raw = row[key]?.trim();
    return raw ? finiteScore(Number(raw)) : null;
  });
  if (values.some((value) => value === null) || values.length === 0) return null;
  return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
}

function parseLive(csvText: string, categoriesText: string, version: string): { rows: PublicBoardRow[]; columns: PublicBoardColumn[] } {
  const categories = JSON.parse(categoriesText) as Record<string, string[]>;
  const categoryNames = Object.keys(categories);
  if (categoryNames.length === 0 || categoryNames.some((key) => !Array.isArray(categories[key]) || categories[key].length === 0 || categories[key].some((task) => typeof task !== "string" || !task.trim()))) throw new Error("LiveBench categories schema invalid");
  const parsed = parseCsv(csvText); const headers = parsed[0];
  if (!headers || headers[0] !== "model" || new Set(headers).size !== headers.length) throw new Error("LiveBench CSV schema invalid");
  for (const category of categoryNames) for (const task of categories[category]) {
    if (!headers.includes(task)) throw new Error(`LiveBench CSV missing task column: ${task}`);
  }
  const rows: PublicBoardRow[] = [];
  for (const cells of parsed.slice(1)) {
    const id = cells[0]?.trim(); if (!id) continue;
    const raw: Record<string, string> = {}; headers.forEach((h, i) => { raw[h] = cells[i] ?? ""; });
    const values: Record<string, number | null> = {};
    const means = categoryNames.map((category) => { const mean = categoryMean(raw, categories[category]); values[category] = mean; return mean; });
    const valid = means.filter((v): v is number => v !== null);
    let score = valid.length === categoryNames.length ? valid.reduce((a, b) => a + b, 0) / categoryNames.length : null;
    const override = id === "grok-3-thinking" ? 72 : id === "grok-3" ? 58 : null;
    if (override !== null) score = override;
    rows.push({ id, name: id, score, values, url: "https://livebench.ai/", warning: override === null ? undefined : "LiveBench upstream global-score override; see official averaging methodology." });
  }
  if (!rows.length) throw new Error("LiveBench CSV has no rows");
  return { rows, columns: categoryNames.map((key) => ({ key, label: key })) };
}

function parseSwe(text: string): { rows: PublicBoardRow[]; sourceUpdatedAt: string | null } {
  const json = JSON.parse(text) as { leaderboards?: Array<{ name?: string; results?: Array<Record<string, unknown>> }> };
  const board = json.leaderboards?.find((b) => b.name === "Verified");
  if (!board?.results?.length) throw new Error("SWE-bench Verified schema missing");
  const rows: PublicBoardRow[] = []; let latest: string | null = null;
  for (const raw of board.results) {
    const score = finiteScore(raw.resolved); if (score === null) continue;
    const agent = typeof raw.agent === "string" ? raw.agent : "Unknown agent";
    const model = typeof raw.model_display === "string" && raw.model_display.trim() ? raw.model_display.trim() : "Unknown model";
    const suppliedName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
    const name = suppliedName || `${agent} + ${model}`;
    const date = typeof raw.date === "string" && !Number.isNaN(Date.parse(raw.date)) ? raw.date : undefined;
    if (date && (!latest || date > latest)) latest = date;
    const warning = typeof raw.warning === "string" && raw.warning.trim() ? raw.warning.trim() : undefined;
    rows.push({
      id: typeof raw.folder === "string" ? raw.folder : name,
      name,
      score,
      values: { resolved: score },
      url: typeof raw.site === "string" ? raw.site : "https://www.swebench.com/",
      testedAt: date,
      detail: `agent: ${agent} · model: ${model}`,
      status: raw.checked === true ? "checked" : "not marked checked",
      warning,
    });
  }
  if (!rows.length) throw new Error("SWE-bench Verified has no valid scores");
  return { rows, sourceUpdatedAt: latest };
}

async function latestLiveVersion(signal: AbortSignal): Promise<string> {
  const source = await fetchText("https://raw.githubusercontent.com/LiveBench/new-livebench/main/src/lib/constants.js", signal);
  const releases = parseReleaseDates(source);
  const latest = releases.sort().at(-1);
  if (!latest) throw new Error("LiveBench has no valid release");
  return latest;
}

async function refreshOne(def: typeof definitions[number], signal: AbortSignal): Promise<void> {
  const current = hydrate(def); const fetchedAt = new Date().toISOString();
  try {
    if (def.kind === "live") {
      const version = await latestLiveVersion(signal);
      const [csv, categories] = await Promise.all([
        fetchText(`https://livebench.ai/table_${version.replaceAll("-", "_")}.csv`, signal),
        fetchText(`https://livebench.ai/categories_${version.replaceAll("-", "_")}.json`, signal),
      ]);
      const parsed = parseLive(csv, categories, version);
      const next = { ...current, columns: parsed.columns, rows: parsed.rows, sourceVersion: version, fetchedAt, sourceUpdatedAt: null, sourceUpdatedLabel: "Suite release", error: null, stale: false };
      if (stopped) return; cache.set(def.id, next); setMeta(metaKey(def.id), JSON.stringify(next));
    } else {
      const parsed = parseSwe(await fetchText("https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json", signal));
      const next = { ...current, columns: [], rows: parsed.rows, sourceVersion: null, fetchedAt, sourceUpdatedAt: parsed.sourceUpdatedAt, sourceUpdatedLabel: "Latest submission", error: null, stale: false };
      if (stopped) return; cache.set(def.id, next); setMeta(metaKey(def.id), JSON.stringify(next));
    }
  } catch (err) {
    if (stopped) return;
    cache.set(def.id, { ...current, error: err instanceof Error ? err.message : String(err), stale: true });
  }
}

function withFreshness(board: PublicBoard): PublicBoard {
  if (!board.fetchedAt) return board;
  const fetched = Date.parse(board.fetchedAt);
  const stale = board.stale || (Number.isFinite(fetched) && Date.now() - fetched > POLL_INTERVAL_MS * 2);
  return stale === board.stale ? board : { ...board, stale };
}
export function getPublicBenchmarks(): PublicBenchmarks {
  return { boards: definitions.map(hydrate).map(withFreshness).map((board) => ({ ...board, rows: [...board.rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) })) };
}
export async function refreshPublicBenchmarks(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  if (Date.now() - lastRefreshMs < REFRESH_COOLDOWN_MS) return;
  lastRefreshMs = Date.now(); const controller = new AbortController(); activeController = controller; const runGeneration = generation;
  refreshPromise = Promise.all(definitions.map((def) => refreshOne(def, controller.signal))).then(() => undefined).finally(() => {
    if (runGeneration !== generation) controller.abort();
    if (activeController === controller) activeController = null;
    refreshPromise = null;
  });
  return refreshPromise;
}
export function startPublicBenchmarkPolling(onUpdate?: () => void): void {
  stopped = false; generation++;
  void refreshPublicBenchmarks().then(() => { if (!stopped) onUpdate?.(); }).catch(() => { if (!stopped) onUpdate?.(); });
  timer = setInterval(() => void refreshPublicBenchmarks().then(() => { if (!stopped) onUpdate?.(); }).catch(() => { if (!stopped) onUpdate?.(); }), POLL_INTERVAL_MS); timer.unref?.();
}
export function stopPublicBenchmarkPolling(): void {
  stopped = true;
  generation++;
  activeController?.abort();
  activeController = null;
  if (timer) clearInterval(timer);
  timer = undefined;
}
