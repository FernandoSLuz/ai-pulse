/**
 * Accessibility enrichment is deliberately conservative. A search result on
 * HF is not provenance: third parties can upload a quantization or a model
 * with an identical name. Only an exact model under a verified publisher
 * organization can enrich an AA row; otherwise the existing AA label stays.
 */
function norm(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }
function compact(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function publisherKey(value: string): string {
  return compact(value).replace(/(?:thinking|reasoning|low|medium|high|max|xhigh)$/i, "");
}

const VERIFIED_ORGS: Record<string, string[]> = {
  meta: ["meta-llama", "facebook"],
  mistral: ["mistralai"],
  deepseek: ["deepseek-ai"],
  qwen: ["qwen"],
  alibaba: ["qwen"],
  google: ["google"],
  "google deepmind": ["google"],
  microsoft: ["microsoft"],
  "allen ai": ["allenai"],
  "hugging face": ["huggingface"],
};

interface TargetModel {
  slug: string; name: string; creator: string; accessibility: string; accessibilityScore: number;
  license?: string | null; licenseUrl?: string | null; weightsUrl?: string | null;
}
interface HuggingFaceModel {
  id: string; pipeline_tag?: string; gated?: boolean | string; private?: boolean;
  cardData?: { license?: unknown }; license?: unknown;
}

function setUnknown(model: TargetModel): void {
  if (!model.accessibility || model.accessibility === "API only") {
    model.accessibility = "Unknown";
    model.accessibilityScore = 0;
  }
}

function verifiedId(model: TargetModel, id: string): boolean {
  const [org, repo] = id.split("/", 2);
  const allowed = VERIFIED_ORGS[norm(model.creator)] ?? [];
  if (!org || !repo || !allowed.includes(org.toLowerCase())) return false;
  const slug = publisherKey(model.slug);
  const candidate = publisherKey(repo);
  // Only exact matches after known AA effort suffix normalization are trusted.
  return candidate === slug;
}

export async function enrichAccessibility(models: TargetModel[], maxLookups = 40): Promise<void> {
  let lookups = 0;
  for (const model of models) {
    if (lookups >= maxLookups) { setUnknown(model); continue; }
    lookups++;
    try {
      const query = encodeURIComponent(model.slug.replace(/-/g, " ").slice(0, 60));
      const searchRes = await fetch(`https://huggingface.co/api/models?search=${query}&limit=10`, { signal: AbortSignal.timeout(5000) });
      if (!searchRes.ok) { setUnknown(model); continue; }
      const results = await searchRes.json() as HuggingFaceModel[];
      const match = results.find((r) => verifiedId(model, r.id));
      if (!match || match.private || (match.pipeline_tag && !["text-generation", "text2text-generation"].includes(match.pipeline_tag))) {
        setUnknown(model); continue;
      }
      const detailRes = await fetch(`https://huggingface.co/api/models/${match.id}`, { signal: AbortSignal.timeout(5000) });
      if (!detailRes.ok) { setUnknown(model); continue; }
      const detail = await detailRes.json() as HuggingFaceModel;
      const rawLicense = detail.cardData?.license ?? detail.license;
      const license = typeof rawLicense === "string" && /^[a-z0-9][a-z0-9.+_-]{1,80}$/i.test(rawLicense.trim()) ? rawLicense.trim() : null;
      model.weightsUrl = `https://huggingface.co/${match.id}`;
      model.license = license;
      model.licenseUrl = license ? `https://huggingface.co/${match.id}` : null;
      // A verified upstream repository proves published weights, but license
      // alone does not establish Open Source AI compliance. Keep one label.
      model.accessibility = detail.gated ? "Gated" : "Open weights";
      model.accessibilityScore = detail.gated ? 3 : 4;
    } catch {
      setUnknown(model);
    }
  }
}
