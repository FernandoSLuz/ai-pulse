import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pulse-youtube-smoke-"));
process.env.AI_PULSE_DATA_DIR = dataDir;
const { getYouTubeUserChannels, saveYouTubeUserChannel, deleteYouTubeUserChannel } = await import("../src/db.js");
const { normalizeYouTubeChannelInput, resolveYouTubeChannel } = await import("../src/fetchers/youtube-channels.js");
const { registerYouTubeChannelRoutes } = await import("../src/youtube/routes.js");

for (const input of ["https://evil.example/channel/UC1234567890123456789012", "https://www.youtube.com/watch?v=abc", "not a channel"]) {
  assert.throws(() => normalizeYouTubeChannelInput(input), /YouTube|valid|official/i);
}
assert.equal(normalizeYouTubeChannelInput("@Example_AI").url, "https://www.youtube.com/@Example_AI");

const oldFetch = globalThis.fetch;
try {
  let feedCalls = 0;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("feeds/videos.xml")) {
      feedCalls += 1;
      return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Example AI</title><entry><yt:videoId xmlns:yt="http://www.youtube.com/xml/schemas/2015">video_1</yt:videoId><published>${new Date().toISOString()}</published><link href="https://www.youtube.com/watch?v=video_1" /></entry></feed>`, { status: 200 });
    }
    if (url.includes("/@Example_AI")) {
      return new Response('<html><head><meta itemprop="channelId" content="UC1234567890123456789012"><script>{"channelId":"UC0000000000000000000000","channelMetadataRenderer":{"externalId":"UC1234567890123456789012"}}</script><link rel="canonical" href="https://www.youtube.com/@Example_AI"></head></html>', { status: 200 });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const resolved = await resolveYouTubeChannel("@Example_AI", "creator");
  assert.equal(resolved.channelId, "UC1234567890123456789012");
  assert.equal(resolved.name, "Example AI");
  assert.equal(resolved.kind, "creator");
  feedCalls = 0;

  const api = express();
  api.use(express.json());
  registerYouTubeChannelRoutes(api);
  const server = http.createServer(api);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const added = await oldFetch(`${base}/api/videos/channels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "@Example_AI", kind: "creator" }) });
    assert.equal(added.status, 201);
    assert.equal(feedCalls, 1, "initial POST reuses its validated RSS response");
    const crossKind = await oldFetch(`${base}/api/videos/channels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "@Example_AI", kind: "company" }) });
    assert.equal(crossKind.status, 409, "same channel cannot be followed under another kind");
    const listed = await oldFetch(`${base}/api/videos/channels?kind=creator`);
    assert.equal((await listed.json()).channels.some((channel: { channelId: string }) => channel.channelId === resolved.channelId), true);
    const removed = await oldFetch(`${base}/api/videos/channels/${resolved.channelId}?kind=creator`, { method: "DELETE" });
    assert.equal(removed.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const creator = saveYouTubeUserChannel(resolved);
  saveYouTubeUserChannel(resolved);
  assert.equal(getYouTubeUserChannels("creator").length, 1, "duplicate creator is idempotent");
  assert.equal(deleteYouTubeUserChannel(creator.channelId, "creator"), true);
  assert.equal(getYouTubeUserChannels("creator").length, 0, "creator removal persists");
  const company = saveYouTubeUserChannel({ ...resolved, channelId: "UC9999999999999999999999", kind: "company" });
  assert.equal(getYouTubeUserChannels("company").some((channel) => channel.channelId === company.channelId), true, "kind separation persists");

  globalThis.fetch = (async (input: string | URL) => {
    if (String(input).includes("feeds/videos.xml")) {
      return new Response('<feed><title>Old</title><entry><published>2020-01-01T00:00:00Z</published></entry></feed>', { status: 200 });
    }
    return new Response('<meta itemprop="channelId" content="UC1234567890123456789012">', { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => resolveYouTubeChannel("@Example_AI", "creator"), /last 90 days/i);
} finally {
  globalThis.fetch = oldFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log("youtube channels smoke: OK");
