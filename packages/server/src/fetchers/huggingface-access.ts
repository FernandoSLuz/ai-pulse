const OPEN_CREATORS = new Set([
  "meta",
  "mistral",
  "deepseek",
  "alibaba",
  "qwen",
  "eleutherai",
  "hugging face",
  "allen ai",
  "nvidia",
]);

const PROPRIETARY_CREATORS = new Set([
  "openai",
  "anthropic",
  "google",
  "google deepmind",
  "xai",
  "microsoft",
  "amazon",
  "cohere",
  "ai21",
  "perplexity",
]);

function normCreator(creator: string): string {
  return creator.trim().toLowerCase();
}

/** Open-weight model name cues — avoid bare "open" (matches too many false positives). */
function isLikelyOpenModel(name: string): boolean {
  const n = name.toLowerCase();
  return [
    "llama",
    "gemma",
    "mistral",
    "mixtral",
    "qwen",
    "deepseek",
    "granite",
    "phi-",
    "gpt-oss",
    "open-weight",
    "open weight",
  ].some((k) => n.includes(k));
}

/** Frontier proprietary product names — never label these Open via HF fuzzy match. */
function isClearlyProprietaryModel(name: string, creator: string): boolean {
  const n = name.toLowerCase();
  const c = normCreator(creator);
  if (PROPRIETARY_CREATORS.has(c)) return !isLikelyOpenModel(name);
  return [
    "claude",
    "fable",
    "mythos",
    "opus",
    "sonnet",
    "haiku",
    "gpt-5",
    "gpt-4",
    "chatgpt",
    "o1-",
    "o3-",
    "o4-",
    "gemini",
    "grok",
    "codex",
  ].some((k) => n.includes(k));
}

export async function enrichAccessibility(
  models: { slug: string; name: string; creator: string; accessibility: string; accessibilityScore: number }[],
  maxLookups = 40,
): Promise<void> {
  let lookups = 0;
  for (const model of models) {
    const creator = normCreator(model.creator);

    if (isClearlyProprietaryModel(model.name, model.creator)) {
      model.accessibility = "API only";
      model.accessibilityScore = 1;
      continue;
    }

    if (OPEN_CREATORS.has(creator)) {
      model.accessibility = "Open weights";
      model.accessibilityScore = 4;
      continue;
    }

    if (creator === "google" && model.name.toLowerCase().includes("gemma")) {
      model.accessibility = "Open weights";
      model.accessibilityScore = 4;
      continue;
    }

    if (lookups >= maxLookups) {
      model.accessibility = model.accessibility || "API only";
      model.accessibilityScore = model.accessibilityScore || 1;
      continue;
    }
    lookups++;

    try {
      const searchTerm = model.slug.replace(/-/g, " ").slice(0, 40);
      const res = await fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(searchTerm)}&limit=5`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        model.accessibility = "API only";
        model.accessibilityScore = 1;
        continue;
      }
      const results = (await res.json()) as {
        id: string;
        pipeline_tag?: string;
        gated?: boolean | string;
        modelId?: string;
      }[];
      const slugNorm = model.slug.toLowerCase().replace(/[^a-z0-9]/g, "");
      const match = results.find((r) => {
        const idNorm = r.id.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          (r.pipeline_tag === "text-generation" || r.pipeline_tag === "text2text-generation") &&
          (idNorm.includes(slugNorm.slice(0, 12)) || slugNorm.includes(idNorm.slice(0, 12)))
        );
      });
      if (match) {
        model.accessibility = match.gated ? "Gated (HF)" : "Open weights (HF)";
        model.accessibilityScore = match.gated ? 3 : 4;
      } else {
        model.accessibility = "API only";
        model.accessibilityScore = 1;
      }
    } catch {
      model.accessibility = "API only";
      model.accessibilityScore = 1;
    }
  }
}
