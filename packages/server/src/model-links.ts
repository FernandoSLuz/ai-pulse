/** Link benchmark results to their exact source configuration. */
export function getModelLink(slug: string, _creator: string): string | null {
  if (!slug) return null;
  // Link each result to the evidence for that exact tested configuration.
  return `https://artificialanalysis.ai/models/${encodeURIComponent(slug)}`;
}

export function withModelLinks<T extends { slug: string; creator: string }>(
  models: T[]
): (T & { url: string | null })[] {
  return models.map((m) => ({ ...m, url: getModelLink(m.slug, m.creator) }));
}
