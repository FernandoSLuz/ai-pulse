import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
const ASSETS = new Map([
  ["/x-embed.html", { file: "x-embed.html", type: "text/html; charset=utf-8" }],
  ["/x-embed.js", { file: "x-embed.js", type: "application/javascript; charset=utf-8" }],
  ["/x-embed.css", { file: "x-embed.css", type: "text/css; charset=utf-8" }],
]);

function contentSecurityPolicy(allowedParentOrigins: string[]): string {
  const frameAncestors = allowedParentOrigins.length > 0
    ? allowedParentOrigins.join(" ")
    : "'none'";

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://platform.twitter.com https://syndication.twitter.com https://cdn.syndication.twimg.com",
    "style-src 'self' 'unsafe-inline' https://platform.twitter.com https://*.twimg.com",
    "img-src https://*.twimg.com https://*.twitter.com https://*.x.com data:",
    "font-src https://*.twimg.com https://*.twitter.com https://*.x.com data:",
    "media-src https://*.twimg.com https://*.twitter.com https://*.x.com data:",
    "frame-src 'self' https://platform.twitter.com https://syndication.twitter.com",
    "child-src 'self' https://platform.twitter.com https://syndication.twitter.com",
    "connect-src https://platform.twitter.com https://syndication.twitter.com https://cdn.syndication.twimg.com https://api.x.com https://x.com",
    `frame-ancestors ${frameAncestors}`,
    "sandbox allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
  ].join("; ");
}

function normalizeAllowedOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (!/^https?:$/.test(new URL(value).protocol)) {
    throw new Error(`X embed parent origin must use http or https: ${value}`);
  }
  return origin;
}

export async function startXEmbedHost(
  webRoot: string,
  allowedParentOrigins: string[],
): Promise<{ origin: string; close: () => Promise<void> }> {
  const parentOrigins = [...new Set(allowedParentOrigins.map(normalizeAllowedOrigin))];
  const csp = contentSecurityPolicy(parentOrigins);
  const server = http.createServer(async (request, response) => {
    const host = request.headers.host;
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const expectedHost = `${LOOPBACK_HOST}:${port}`;

    if (host !== expectedHost) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid Host header\n");
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Method Not Allowed\n");
      return;
    }

    // Match the raw path before URL normalization so traversal-looking paths
    // cannot collapse into one of the three permitted asset names.
    const pathname = (request.url ?? "/").split("?", 1)[0];

    const asset = ASSETS.get(pathname);
    if (!asset) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found\n");
      return;
    }

    try {
      const body = await fs.readFile(path.join(webRoot, asset.file));
      const headers: Record<string, string | number> = {
        "cache-control": "no-store",
        "content-length": body.byteLength,
        "content-type": asset.type,
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
      };
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, LOOPBACK_HOST);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("X embed host did not expose a TCP address");
  }
  const origin = `http://${LOOPBACK_HOST}:${address.port}`;
  let closed: Promise<void> | undefined;
  return {
    origin,
    close: () => {
      closed ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closed;
    },
  };
}
