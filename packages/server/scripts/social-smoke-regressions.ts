import assert from "node:assert/strict";

const oldFetch = globalThis.fetch;
const oldToken = process.env.X_API_BEARER_TOKEN;
process.env.X_API_BEARER_TOKEN = "test-token";
try {
  const { fetchXFeed } = await import("../src/social/x.js");
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
} finally {
  globalThis.fetch = oldFetch;
  if (oldToken === undefined) delete process.env.X_API_BEARER_TOKEN;
  else process.env.X_API_BEARER_TOKEN = oldToken;
}

console.log("social smoke regressions: OK");
