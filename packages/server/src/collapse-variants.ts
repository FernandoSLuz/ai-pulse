import type { ModelRecord } from "./types.js";

// Closed vocabulary of effort/behavior qualifiers that may appear INSIDE a
// parenthesized group. Two-word compound forms are listed explicitly because
// real names use them (e.g. "Claude Opus 4.6 (Non-reasoning, High Effort)").
// "preview" is included because the mission mandates removing it, but it is a
// release-channel marker (a cousin of "(ChatGPT)", which is kept) — the dry-run
// flags any group formed by its removal (human gate 3 arbitration note).
const EFFORT_VOCAB = new Set([
  "reasoning",
  "non-reasoning",
  "adaptive reasoning",
  "thinking",
  "non-thinking",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "low effort",
  "medium effort",
  "high effort",
  "max effort",
  "preview",
]);

// Standalone trailing words removed OUTSIDE parentheses.
const TRAILING_WORDS = new Set(["thinking", "reasoning", "preview"]);

// Names/slugs (or group keys) that must never be merged. Populated only if
// Fernando marks exceptions at human gate 3.
export const NEVER_COLLAPSE: string[] = [];

export interface VariantRef {
  slug: string;
  name: string;
}

export interface CollapsedModel extends ModelRecord {
  displayName: string;
  variants: VariantRef[];
}

export interface CollapseResult {
  models: CollapsedModel[];
  variantAliases: Record<string, string>;
  variantsCollapsed: number;
}

function isEffortToken(rawToken: string): boolean {
  let token = rawToken.trim().toLowerCase();
  if (token === "") return true;
  // "high effort" / "max effort" equivalent: drop the trailing "effort" word
  // before testing membership, so "HIGH EFFORT" and "high" both match.
  const words = token.split(/\s+/);
  if (words[words.length - 1] === "effort") {
    words.pop();
    token = words.join(" ").trim();
  }
  return EFFORT_VOCAB.has(token);
}

function stripTrailingQualifierWords(name: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let text = name.trim();
  for (;;) {
    const match = text.match(/\s+([^\s()]+)$/);
    if (!match) break;
    if (!TRAILING_WORDS.has(match[1].toLowerCase())) break;
    removed.push(match[1]);
    text = text.slice(0, text.length - match[0].length).trim();
  }
  return { text, removed };
}

function stripBuildSuffix(name: string): string {
  // Isolated "-c" build qualifier (Cursor-style) at the very END of the name,
  // outside parentheses. No current DB name uses it; the dry-run confirms this
  // is a no-op.
  if (name.toLowerCase().endsWith("-c")) {
    return name.slice(0, -2).trim();
  }
  return name;
}

/**
 * Normalizes a model name into a collapse key. Effort/behavior tokens inside
 * parentheses are discarded; non-effort tokens (dates like "june '24",
 * "chatgpt", "opus 4.8 fallback") are KEPT, so checkpoints and deployments
 * stay separate. "GPT-5.6 Sol" and "GPT-5.6 Terra" produce different keys by
 * construction (the suffix is not in the vocabulary).
 */
export function normalizeVariantKey(name: string): string {
  return normalizeName(name).key;
}

interface NormalizedName {
  key: string;
  base: string;
  removedPreview: boolean;
}

function normalizeName(name: string): NormalizedName {
  let removedPreview = false;
  let text = name.trim();
  text = stripBuildSuffix(text);

  const outParts: string[] = [];
  let rest = text;
  for (;;) {
    const open = rest.lastIndexOf("(");
    if (open === -1) break;
    const close = rest.indexOf(")", open);
    if (close === -1) break;
    const inner = rest.slice(open + 1, close);
    const kept = inner
      .split(",")
      .filter((tok) => {
        if (isEffortToken(tok)) {
          if (tok.trim().toLowerCase() === "preview") removedPreview = true;
          return false;
        }
        return true;
      })
      .map((tok) => tok.trim())
      .join(", ");
    if (kept !== "") {
      outParts.unshift(`(${kept})`);
    }
    rest = (rest.slice(0, open) + " " + rest.slice(close + 1)).trim();
  }

  const trailing = stripTrailingQualifierWords(rest);
  if (trailing.removed.some((w) => w.toLowerCase() === "preview")) removedPreview = true;

  let base = [trailing.text, ...outParts].join(" ").replace(/\s+/g, " ").trim();
  base = stripTrailingQualifierWords(base).text;
  return { key: base.toLowerCase(), base, removedPreview };
}

function priceRank(model: ModelRecord): number {
  return model.priceBlended && model.priceBlended > 0 ? model.priceBlended : Number.POSITIVE_INFINITY;
}

/**
 * Groups models by normalized variant key and picks a survivor per group:
 * highest intelligence → highest coding → lowest priceBlended (0/null treated
 * as +Infinity) → stable original order. The survivor keeps its original
 * record/slug and gains displayName + the list of absorbed variants.
 */
export function collapseVariants(models: ModelRecord[]): CollapseResult {
  const isProtected = (model: ModelRecord) =>
    NEVER_COLLAPSE.includes(model.slug) || NEVER_COLLAPSE.includes(normalizeVariantKey(model.name));

  const groups = new Map<string, { index: number; model: ModelRecord }[]>();
  models.forEach((model, index) => {
    if (isProtected(model)) return;
    const key = normalizeVariantKey(model.name);
    const bucket = groups.get(key);
    if (bucket) bucket.push({ index, model });
    else groups.set(key, [{ index, model }]);
  });

  const compare = (a: { index: number; model: ModelRecord }, b: { index: number; model: ModelRecord }) =>
    b.model.intelligence - a.model.intelligence ||
    b.model.coding - a.model.coding ||
    priceRank(a.model) - priceRank(b.model) ||
    a.index - b.index;

  const variantAliases: Record<string, string> = {};
  let variantsCollapsed = 0;
  const result: CollapsedModel[] = [];

  models.forEach((model, index) => {
    const key = normalizeVariantKey(model.name);
    if (isProtected(model) || groups.get(key)!.length === 1) {
      result.push({ ...model, displayName: model.name, variants: [] });
      return;
    }
    const bucket = groups.get(key)!;
    const winner = [...bucket].sort(compare)[0];
    if (winner.index !== index) return;
    const absorbed = bucket
      .filter((m) => m.index !== winner.index)
      .sort((a, b) => a.index - b.index)
      .map((m) => ({ slug: m.model.slug, name: m.model.name }));
    for (const variant of absorbed) {
      variantAliases[variant.slug] = winner.model.slug;
    }
    variantsCollapsed += absorbed.length;
    result.push({
      ...winner.model,
      displayName: normalizeName(winner.model.name).base,
      variants: absorbed,
    });
  });

  return { models: result, variantAliases, variantsCollapsed };
}
