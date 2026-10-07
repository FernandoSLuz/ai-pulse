import assert from "node:assert/strict";

const oldFetch = globalThis.fetch;
const oldToken = process.env.X_API_BEARER_TOKEN;
process.env.X_API_BEARER_TOKEN = "test-token";
try {
  const { fetchXFeed, normalizeXHandle } = await import("../src/social/x.js");
  const validInputs: Array<[string, string]> = [
    ["sama", "sama"], ["@SamA", "sama"], ["https://x.com/@SamA", "sama"], ["https://x.com/SamA", "sama"],
    ["https://x.com/SamA?s=21", "sama"], ["https://twitter.com/@SamA?lang=en#bio", "sama"],
    ["x.com/SamA", "sama"], ["www.twitter.com/@SamA?lang=en", "sama"],
    ["https://www.twitter.com/SamA/", "sama"], ["http://mobile.x.com/SamA", "sama"],
  ];
  for (const [input, expected] of validInputs) {
    assert.equal(normalizeXHandle(input), expected, `normalizes ${input}`);
  }
  for (const input of [
    "https://evil.example/sama", "https://evil.x.com/sama", "https://x.com.evil/sama",
    "https://x.com/sama/status/1", "https://x.com/lists/1",
    "https://x.com/search", "https://user:pass@x.com/sama",
    "https://x.com:8443/sama", "sama-too-long-handle", "@", "", "https://x.com/%2Fsama",
  ]) assert.equal(normalizeXHandle(input), null, `rejects ${input}`);
  let calls = 0;
  globalThis.fetch = (async (input: string | URL) => {
    calls++;
    const url = String(input);
    if (url.includes("/users/by")) {
      return new Response(JSON.stringify({ data: [{ id: "1", username: "OpenAI", name: "OpenAI" }] }), { status: 200 });
    }
    if (url.includes("/users/1/tweets")) {
      return new Response(JSON.stringify({ data: [{ id: "p1", text: "hello", created_at: "2026-10-07T12:00:00.000Z" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "secret-account-detail" }), { status: 403 });
  }) as typeof fetch;
  const partial = await fetchXFeed([
    { handle: "openai", name: "OpenAI", profileUrl: "https://x.com/openai", source: "default" },
    { handle: "missing", name: "Missing", profileUrl: "https://x.com/missing", source: "user" },
  ]);
  assert.equal(partial.items.length, 1);
  assert.match(partial.error ?? "", /missing/i);
  assert.equal(partial.items[0].createdAt, "2026-10-07T12:00:00.000Z");
  assert.equal(calls, 2);

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "sensitive detail" }), { status: 403 })) as typeof fetch;
  const failed = await fetchXFeed([{ handle: "openai", name: "OpenAI", profileUrl: "https://x.com/openai", source: "default" }]);
  assert.match(failed.error ?? "", /HTTP 403/);
  assert.doesNotMatch(failed.error ?? "", /sensitive detail/);

  delete process.env.X_API_BEARER_TOKEN;
  const embedded = await fetchXFeed([{ handle: "openai", name: "OpenAI", profileUrl: "https://x.com/openai", source: "default" }]);
  assert.equal(embedded.mode, "embed");
  assert.equal(embedded.error, null);
  assert.equal(embedded.items.length, 0);
} finally {
  globalThis.fetch = oldFetch;
  if (oldToken === undefined) delete process.env.X_API_BEARER_TOKEN;
  else process.env.X_API_BEARER_TOKEN = oldToken;
}

console.log("social smoke regressions: OK");
