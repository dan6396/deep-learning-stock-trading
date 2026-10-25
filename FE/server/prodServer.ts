import { createServer, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { apiMiddleware } from "./routes";
import { tokenMatches } from "./writeSecurity";
import { startPerformanceScheduler } from "./performance";
import { startRefreshAhead } from "./refreshAhead";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".map": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};
const compressible = new Set([".html", ".js", ".css", ".svg", ".json", ".txt", ".webmanifest", ".map"]);

export function validateProductionTokens(env = process.env): void {
  for (const name of ["ADMIN_API_TOKEN", "CRON_SECRET"] as const) {
    const value = env[name]?.trim();
    if (!value) console.warn(`[server] ${name} is empty; requests requiring this credential will be rejected.`);
    else if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  }
  if (env.SNAPSHOT_REFRESH_KEY?.trim() && env.SNAPSHOT_REFRESH_KEY.trim().length < 32) throw new Error("SNAPSHOT_REFRESH_KEY must contain at least 32 characters when configured.");
  if (env.ADMIN_API_TOKEN?.trim() && tokenMatches(env.ADMIN_API_TOKEN.trim(), env.CRON_SECRET)) throw new Error("ADMIN_API_TOKEN and CRON_SECRET must be different.");
}

function contentSecurityPolicy(root: string): string {
  const index = readFileSync(resolve(root, "index.html"), "utf8");
  const hashes = [...index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]) && match[2].includes("kospi-theme.v1"))
    // HTML parsing normalizes CRLF/CR to LF before CSP hashes are checked.
    .map(match => `'sha256-${Buffer.from(createHash("sha256").update(match[2].replace(/\r\n?/g, "\n")).digest("hex"), "hex").toString("base64")}'`);
  return `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
}

function internalError(response: ServerResponse) {
  if (response.headersSent) { response.end(); return; }
  response.removeHeader("Content-Encoding");
  response.setHeader("Cache-Control", "no-store");
  response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }).end('{"error":"Internal server error"}');
}

export function createProductionServer(dist = fileURLToPath(new URL("../dist/", import.meta.url))) {
  const root = realpathSync(dist), policy = contentSecurityPolicy(root);
  function staticFile(relative: string): string | null {
    try {
      const path = realpathSync(resolve(root, relative));
      return path.startsWith(root + sep) && statSync(path).isFile() ? path : null;
    } catch { return null; }
  }
  return createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", policy);
    try {
      let path: string;
      try { path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname); }
      catch { response.writeHead(400).end("Bad request"); return; }
      if (path === "/api" || path.startsWith("/api/")) {
        response.setHeader("Cache-Control", "no-store");
        const missing = () => { response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"API not found"}'); };
        if (path === "/api") missing(); else apiMiddleware(request, response, missing);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
      // Never expose dotfiles or paths outside dist, including through symlinks.
      if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part.startsWith("."))) { response.writeHead(404).end(); return; }
      const relative = path.replace(/^\/+/, "");
      const about = ["/about", "/about/", "/about.html", "/about/index.html"].includes(path);
      const file = about ? staticFile("about.html") ?? staticFile("about/index.html") : staticFile(relative);
      const selected = file ?? (!extname(path) ? staticFile("index.html") : null);
      if (!selected) { response.writeHead(404).end(); return; }
      const extension = extname(selected).toLowerCase();
      response.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
      response.setHeader("Cache-Control", extension !== ".html" && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      if (compressible.has(extension)) response.setHeader("Vary", "Accept-Encoding");
      if (extension === ".html") {
        const fileStat = statSync(selected), etag = `W/"${fileStat.mtimeMs.toString(16)}-${fileStat.size.toString(16)}"`;
        response.setHeader("ETag", etag);
        if (request.headers["if-none-match"]?.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""))) { response.writeHead(304).end(); return; }
      }
      const gzip = compressible.has(extension) && request.headers["accept-encoding"]?.split(",").some(value => {
        const [encoding, ...parameters] = value.trim().split(";");
        const quality = parameters.find(parameter => /^\s*q\s*=/.test(parameter));
        return encoding.toLowerCase() === "gzip" && (!quality || Number(quality.split("=")[1]) > 0);
      });
      if (gzip) response.setHeader("Content-Encoding", "gzip");
      if (request.method === "HEAD") { response.end(); return; }
      const stream = createReadStream(selected);
      // Keep the response intact until opening succeeds: pipeline destroys its
      // destination on a source error, which would prevent a JSON 500 here.
      const abortBeforeOpen = () => { stream.destroy(); };
      const openingError = () => { if (!response.destroyed) internalError(response); };
      response.once("close", abortBeforeOpen);
      stream.once("error", openingError);
      stream.once("close", () => response.off("close", abortBeforeOpen));
      stream.once("open", () => {
        response.off("close", abortBeforeOpen);
        if (response.destroyed) { stream.destroy(); return; }
        try {
          const transfer = gzip ? pipeline(stream, createGzip(), response) : pipeline(stream, response);
          stream.off("error", openingError);
          void transfer.catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") internalError(response);
          });
        } catch { stream.destroy(); internalError(response); }
      });
    } catch { internalError(response); }
  });
}

export function startProductionServer(dist?: string) {
  validateProductionTokens();
  const server = createProductionServer(dist);
  let stopPerformance = () => {}, stopRefresh = () => {};
  const unhandled = (error: unknown) => {
    const detail = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
    console.error("[server] Unhandled promise rejection.", {
      name: typeof detail.name === "string" ? detail.name : "UnknownError",
      code: typeof detail.code === "string" || typeof detail.code === "number" ? detail.code : null,
    });
  };
  const cleanup = () => {
    stopPerformance(); stopRefresh();
    process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); process.off("unhandledRejection", unhandled);
  };
  const shutdown = () => { cleanup(); server.close(); };
  server.once("listening", () => {
    stopPerformance = startPerformanceScheduler(); stopRefresh = startRefreshAhead();
    console.log(`[server] listening on port ${(server.address() as { port: number }).port}`);
  });
  server.once("close", cleanup);
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(error.code === "EADDRINUSE" ? "[server] EADDRINUSE: port is already in use; choose another PORT or stop the existing server." : "[server] HTTP server failed.");
    process.exitCode = 1; cleanup();
  });
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown); process.on("unhandledRejection", unhandled);
  try { server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0"); }
  catch (error) { cleanup(); throw error; }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { startProductionServer(); }
  catch (error) { console.error(`[server] Startup refused: ${error instanceof Error ? error.message : "invalid configuration"}`); process.exitCode = 1; }
}
