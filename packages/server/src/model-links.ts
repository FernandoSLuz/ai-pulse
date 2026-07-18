/** Known lab homepages + AA model page fallback (we always have slug). */
const CREATOR_URLS: Record<string, string> = {
  OpenAI: "https://openai.com",
  Anthropic: "https://www.anthropic.com",
  Google: "https://ai.google",
  Meta: "https://ai.meta.com",
  xAI: "https://x.ai",
  Mistral: "https://mistral.ai",
  "Mistral AI": "https://mistral.ai",
  DeepSeek: "https://www.deepseek.com",
  Alibaba: "https://qwenlm.github.io",
  Qwen: "https://qwenlm.github.io",
  Microsoft: "https://www.microsoft.com/en-us/ai",
  Cohere: "https://cohere.com",
  Amazon: "https://aws.amazon.com/bedrock/",
  Nvidia: "https://www.nvidia.com/en-us/ai/",
  "Hugging Face": "https://huggingface.co",
  "Hugging Face TB": "https://huggingface.co",
};

export function getModelLink(slug: string, creator: string): string | null {
  if (!slug) return null;
  const creatorUrl = CREATOR_URLS[creator];
  if (creatorUrl) return creatorUrl;
  return `https://artificialanalysis.ai/models/${slug}`;
}

export function withModelLinks<T extends { slug: string; creator: string }>(
  models: T[]
): (T & { url: string | null })[] {
  return models.map((m) => ({ ...m, url: getModelLink(m.slug, m.creator) }));
}
