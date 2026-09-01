import { normalizeVariantKey } from "../src/collapse-variants.js";

const PORT = Number(process.env.PORT) || 3847;
const BASE = `http://127.0.0.1:${PORT}`;

const VIDEO_FIELDS = ["channel", "title", "link", "thumbnail", "publishedAt"] as const;

interface RankingsPayload {
  models?: Array<{ slug?: string; name?: string; kind?: string }>;
  variantAliases?: Record<string, string>;
}

interface StackPayload {
  entries?: Array<{ modelSlug?: string }>;
}

interface VideosPayload {
  items?: Array<Record<string, unknown>>;
  updatedAt?: unknown;
}

let failures = 0;

function report(name: string, ok: boolean, detail: string): void {
  const status = ok ? "OK   " : "FALHA";
  if (!ok) failures += 1;
  console.log(`[${status}] ${name} | ${detail}`);
}

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

async function checkRankingsUniqueness(): Promise<RankingsPayload | null> {
  try {
    const { status, body } = await getJson<RankingsPayload>("/api/rankings");
    if (status !== 200) {
      report("5 leaderboard unique", false, `HTTP ${status}`);
      return null;
    }
    const models = body.models ?? [];
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const model of models) {
      const name = model.name ?? "";
      const key = normalizeVariantKey(name);
      if (seen.has(key)) dupes.push(`${seen.get(key)} + ${name}`);
      else seen.set(key, name);
    }
    report(
      "5 leaderboard unique",
      dupes.length === 0,
      dupes.length === 0
        ? `${models.length} linhas, nenhuma chave de variante repetida`
        : `duplicatas: ${dupes.slice(0, 8).join(" | ")}`,
    );
    return body;
  } catch (err) {
    report("5 leaderboard unique", false, (err as Error).message);
    return null;
  }
}

async function checkStackResolves(rankings: RankingsPayload | null): Promise<void> {
  try {
    const { status, body } = await getJson<StackPayload>("/api/stack");
    if (status !== 200) {
      report("6 my-stack resolve", false, `HTTP ${status}`);
      return;
    }
    if (!rankings?.models) {
      report("6 my-stack resolve", false, "rankings indisponível para cruzar slugs");
      return;
    }
    const visible = new Set(rankings.models.map((m) => m.slug).filter(Boolean) as string[]);
    const aliases = rankings.variantAliases ?? {};
    const entries = (body.entries ?? []).filter((e) => e.modelSlug);
    const missing = entries.filter((e) => {
      const slug = e.modelSlug as string;
      return !visible.has(slug) && !visible.has(aliases[slug] ?? "");
    });
    report(
      "6 my-stack resolve",
      missing.length === 0,
      missing.length === 0
        ? `${entries.length} entries resolvem para linha visível`
        : `não resolvem: ${missing.map((e) => e.modelSlug).join(", ")}`,
    );
  } catch (err) {
    report("6 my-stack resolve", false, (err as Error).message);
  }
}

async function checkVideosContract(): Promise<void> {
  try {
    const { status, body } = await getJson<VideosPayload>("/api/videos?limit=3");
    if (status !== 200) {
      report("7 videos contract", false, `HTTP ${status}`);
      return;
    }
    if (!("items" in body) || !("updatedAt" in body)) {
      report("7 videos contract", false, "payload sem items/updatedAt");
      return;
    }
    const items = body.items ?? [];
    const wrongKind = items.filter((item) => (item.kind ?? "creator") !== "creator");
    const missingFields = items.flatMap((item, i) =>
      VIDEO_FIELDS.filter((field) => item[field] == null || item[field] === "").map(
        (field) => `#${i}.${field}`,
      ),
    );
    const ok = wrongKind.length === 0 && missingFields.length === 0;
    report(
      "7 videos contract",
      ok,
      ok
        ? `${items.length} items creator, campos channel/title/link/thumbnail/publishedAt presentes`
        : [
            wrongKind.length ? `${wrongKind.length} item(s) não-creator` : "",
            missingFields.length ? `campos faltando: ${missingFields.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
    );
  } catch (err) {
    report("7 videos contract", false, (err as Error).message);
  }
}

async function main(): Promise<void> {
  console.log(`=== AI Pulse gate-check contra ${BASE} ===\n`);
  const rankings = await checkRankingsUniqueness();
  await checkStackResolves(rankings);
  await checkVideosContract();
  console.log(`\n=== Resumo: ${failures === 0 ? "TODAS AS CHECAGENS OK" : `${failures} FALHA(S)`} ===`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[gate-check] Erro fatal:", (err as Error).message);
  process.exit(1);
});
