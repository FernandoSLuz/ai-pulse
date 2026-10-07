import assert from "node:assert/strict";
import { dedupeByCredibility, hashId, hasAiSubject, normalizeUrl, scoreRelevance } from "../src/fetchers/rss-aggregator.js";
import type { NewsItem } from "../src/types.js";

const now = Date.now();
const valid = (id: string, title: string, link: string): NewsItem => ({
  id, title, link, source: "fixture", publishedAt: new Date(now - 60_000).toISOString(),
  summary: "", relevanceScore: scoreRelevance(title, "").score, category: "general", tier: 1,
});

assert.notEqual(hashId("https://example.com/a", ""), hashId("https://example.com/b", ""));
assert.equal(hashId("https://example.com/a?utm_source=x", ""), hashId("https://example.com/a", ""));
assert.equal(normalizeUrl("javascript:alert(1)"), "");
assert.equal(hasAiSubject("Daily API maintenance", "ordinary database update"), false);
assert.equal(hasAiSubject("Introducing Grok5", "Our newest assistant"), true);
assert.equal(hasAiSubject("OpenAI releases a model", "new language model"), true);
assert.equal(scoreRelevance("Daily API maintenance", "").score, 30);
assert.equal(scoreRelevance("OpenAI announces a model", "").category, "releases");
assert.equal(dedupeByCredibility([valid("5", "GPT-5 launches", "https://x.test/5"), valid("6", "GPT-6 launches", "https://x.test/6")]).length, 2);
assert.equal(dedupeByCredibility([valid("a", "OpenAI launches model", "https://x.test/story?utm_source=a"), valid("b", "OpenAI launches model", "https://x.test/story?utm_medium=b")]).length, 1);
assert.equal(dedupeByCredibility([valid("a", "GPT-5 release", "https://x.test/a"), valid("b", "GPT-6 release", "https://x.test/b")]).length, 2);
assert.equal(dedupeByCredibility([valid("a", "Model benchmark score increases", "https://x.test/a"), valid("b", "Model benchmark score drops", "https://x.test/b")]).length, 2);

console.log("news smoke regressions: OK");
