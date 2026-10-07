import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request } from "node:http";
import { startXEmbedHost } from "../src/social/embed-host.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-pulse-x-embed-host-"));
await Promise.all([
  fs.writeFile(path.join(root, "x-embed.html"), "<!doctype html><script src=\"x-embed.js\"></script>"),
  fs.writeFile(path.join(root, "x-embed.js"), "window.twttr = {};"),
  fs.writeFile(path.join(root, "x-embed.css"), "body { color: red; }") ,
]);

function fetch(origin: string, pathname: string, method = "GET", host = new URL(origin).host): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path: pathname, method, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const host = await startXEmbedHost(root, ["http://127.0.0.1:3847", "http://localhost:3847"]);
try {
  const port = new URL(host.origin).port;
  assert.notEqual(port, "3847");

  const html = await fetch(host.origin, "/x-embed.html?handle=sama");
  assert.equal(html.status, 200);
  assert.match(html.body, /x-embed\.js/);
  assert.equal(html.headers["access-control-allow-origin"], undefined);
  const csp = String(html.headers["content-security-policy"]);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/platform\.twitter\.com/);
  assert.match(csp, /frame-ancestors http:\/\/127\.0\.0\.1:3847 http:\/\/localhost:3847/);
  assert.match(csp, /sandbox allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox/);

  const head = await fetch(host.origin, "/x-embed.css", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal((await fetch(host.origin, "/x-embed.js")).status, 200);
  assert.equal((await fetch(host.origin, "/x-embed.css")).status, 200);
  assert.equal((await fetch(host.origin, "/x-embed.html/../x-embed.js")).status, 404);
  assert.equal((await fetch(host.origin, "/%2e%2e/x-embed.js")).status, 404);
  assert.equal((await fetch(host.origin, "/x-embed.json")).status, 404);
  assert.equal((await fetch(host.origin, "/api/health")).status, 404);
  assert.equal((await fetch(host.origin, "/api/social")).status, 404);
  assert.equal((await fetch(host.origin, "/app.js")).status, 404);
  assert.equal((await fetch(host.origin, "/")).status, 404);
  assert.equal((await fetch(host.origin, "/x-embed.html", "POST")).status, 405);
  assert.equal((await fetch(host.origin, "/x-embed.html", "OPTIONS")).status, 405);
  assert.equal((await fetch(host.origin, "/x-embed.html", "GET", `localhost:${port}`)).status, 400);
} finally {
  await host.close();
  await host.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("x embed host smoke: OK");
