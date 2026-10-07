// Native-runner integration check: download, verify, infer, stop, restart.
// Uses only a temporary app directory and never the user's running service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-pulse-local-ci-"));
process.env.AI_PULSE_LOCAL_AI_DIR = directory;
const { setupLocalAI, initializeLocalAI, localChat, stopLocalAI, getLocalAIStatus } = await import("../src/local-ai/index.js");
try {
  const status = await setupLocalAI({ profile: "light" });
  assert.equal(status.state, "ready", status.error?.message);
  const answer = await localChat([{ role: "user", content: 'Return a JSON object with one field: "ok": true. Do not add other fields.' }], { json: true, maxTokens: 64 });
  assert.equal(JSON.parse(answer).ok, true);
  await stopLocalAI();
  await initializeLocalAI();
  assert.equal(getLocalAIStatus().state, "ready", getLocalAIStatus().error?.message);
  console.log("Local model setup, inference and restart: OK", process.platform, process.arch);
} finally {
  await stopLocalAI();
  await fs.rm(directory, { recursive: true, force: true });
}
