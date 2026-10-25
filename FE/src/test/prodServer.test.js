// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { get } from "node:http";
const streams = vi.hoisted(() => ({ sources: [], compressors: [], failCreate: false, failOpen: false }));
vi.mock("node:fs", async original => {
  const fs = await original();
  return { ...fs, createReadStream: (...args) => {
    if (streams.failCreate) throw new Error("fixture source failure");
    const source = fs.createReadStream(...(streams.failOpen ? [String(args[0]) + ".missing"] : args)); streams.sources.push(source); return source;
  } };
});
vi.mock("node:zlib", async original => {
  const zlib = await original();
  return { ...zlib, createGzip: (...args) => {
    const compressor = zlib.createGzip(...args); streams.compressors.push(compressor); return compressor;
  } };
});
vi.mock("../../server/backendStatus", () => ({ getBackendStatus: vi.fn(async () => ({ status: "ready" })) }));
vi.mock("../../server/performance", () => ({ startPerformanceScheduler: vi.fn(() => vi.fn()), getPerformancePayload: vi.fn(), startPerformanceCollection: vi.fn(), runPerformanceCollection: vi.fn() }));
vi.mock("../../server/refreshAhead", () => ({ startRefreshAhead: vi.fn(() => vi.fn()) }));
import { createProductionServer, startProductionServer, validateProductionTokens } from "../../server/prodServer";
import { startPerformanceScheduler } from "../../server/performance";
import { startRefreshAhead } from "../../server/refreshAhead";

let server, directory;
beforeEach(() => { streams.sources.length = 0; streams.compressors.length = 0; streams.failCreate = false; streams.failOpen = false; });
afterEach(async () => {
  if (server) { const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed; server = undefined; }
  for (const stream of [...streams.sources, ...streams.compressors]) stream.destroy();
  await vi.waitFor(() => expect([...streams.sources, ...streams.compressors].every(stream => stream.closed)).toBe(true));
  if (directory) { await rm(directory, { recursive: true }); directory = undefined; }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("standalone HTTP server", () => {
  it("warns on empty credentials, rejects short or equal tokens, and never logs their values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateProductionTokens({}); expect(warn).toHaveBeenCalledTimes(2);
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "short", CRON_SECRET: "b".repeat(32) })).toThrow("ADMIN_API_TOKEN must contain at least 32");
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "a".repeat(32), CRON_SECRET: "short" })).toThrow("CRON_SECRET must contain at least 32");
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "a".repeat(32), CRON_SECRET: " a".padEnd(33, "a") + " " })).toThrow("must be different");
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: " a".padEnd(33, "a") + " ", CRON_SECRET: "b".repeat(32) })).not.toThrow();
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "a".repeat(32), CRON_SECRET: "b".repeat(32), SNAPSHOT_REFRESH_KEY: "short" })).toThrow("SNAPSHOT_REFRESH_KEY must contain at least 32");
    for (const key of ["", " \t "]) expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "a".repeat(32), CRON_SECRET: "b".repeat(32), SNAPSHOT_REFRESH_KEY: key })).not.toThrow();
    expect(() => validateProductionTokens({ ADMIN_API_TOKEN: "a".repeat(32), CRON_SECRET: "b".repeat(32), SNAPSHOT_REFRESH_KEY: " refresh".padEnd(33, "r") + " " })).not.toThrow();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("short");
  });
  it.each(["identity", "gzip"])("closes all source and gzip streams after 150 aborted 30MB downloads (%s)", async encoding => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-abort-"));
    await writeFile(join(directory, "index.html"), "<html>SPA</html>");
    const size = 30 * 1024 * 1024;
    await writeFile(join(directory, "large.js"), randomBytes(size));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    server = createProductionServer(directory); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/large.js`;
    await Promise.all(Array.from({ length: 150 }, () => new Promise((resolve, reject) => {
      let received = false;
      const request = get(url, { headers: { "Accept-Encoding": encoding }, agent: false }, response => {
        response.once("data", () => { received = true; response.destroy(); request.destroy(); resolve(); });
        response.on("error", error => { if (!received) reject(error); });
      });
      request.on("error", error => { if (!received) reject(error); });
    })));
    await vi.waitFor(() => {
      expect(streams.sources).toHaveLength(150);
      expect(streams.sources.every(source => source.destroyed && source.closed)).toBe(true);
      expect(streams.compressors).toHaveLength(encoding === "gzip" ? 150 : 0);
      expect(streams.compressors.every(compressor => compressor.destroyed && compressor.closed)).toBe(true);
    });
    expect(streams.sources.every(source => source.bytesRead < size)).toBe(true);
    expect(log).not.toHaveBeenCalled();
  }, 15000);
  it("overrides immutable caching with no-store when a static source fails before headers", async () => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-error-")); await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<html>SPA</html>");
    await writeFile(join(directory, "assets", "test.js"), "fixture");
    server = createProductionServer(directory); server.listen(0, "127.0.0.1"); await once(server, "listening");
    streams.failCreate = true;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/test.js`);
    expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-encoding")).toBeNull(); expect(await response.json()).toEqual({ error: "Internal server error" });
  });
  it.each(["identity", "gzip"])("returns 500 no-store without destroying the response when opening fails (%s)", async encoding => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-open-error-")); await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<html>SPA</html>");
    await writeFile(join(directory, "assets", "test.js"), "fixture");
    server = createProductionServer(directory); server.listen(0, "127.0.0.1"); await once(server, "listening");
    streams.failOpen = true;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/test.js`, { headers: { "Accept-Encoding": encoding } });
    expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-encoding")).toBeNull(); expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(streams.compressors).toHaveLength(0);
    await vi.waitFor(() => expect(streams.sources[0].destroyed && streams.sources[0].closed).toBe(true));
  });
  it("hashes the built theme script and serves cache validators, gzip and expanded content types", async () => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-headers-")); await mkdir(join(directory, "assets"));
    const themeScript = '\r\nlocalStorage.getItem("kospi-theme.v1");\r\n';
    const html = `<html><script>${themeScript}</script>SPA</html>`;
    await writeFile(join(directory, "index.html"), html);
    await writeFile(join(directory, "assets", "test.js"), "export const test = true;".repeat(100));
    const extensions = { TXT: "text/plain", WEBMANIFEST: "application/manifest+json", MAP: "application/json", WOFF: "font/woff", JPG: "image/jpeg", WEBP: "image/webp" };
    for (const extension of Object.keys(extensions)) await writeFile(join(directory, `file.${extension}`), "fixture");
    server = createProductionServer(directory); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + "/", { headers: { "Accept-Encoding": "gzip" } });
    expect(await response.text()).toBe(html);
    expect(response.headers.get("content-encoding")).toBe("gzip"); expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const policy = response.headers.get("content-security-policy");
    expect(policy).toContain(`script-src 'self' 'sha256-${createHash("sha256").update(themeScript.replace(/\r\n?/g, "\n")).digest("base64")}'`);
    for (const directive of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'", "font-src 'self' data:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) expect(policy).toContain(directive);
    const etag = response.headers.get("etag"); expect(etag).toBeTruthy();
    const unchanged = await fetch(base + "/", { headers: { "If-None-Match": etag } }); expect(unchanged.status).toBe(304); expect(await unchanged.text()).toBe("");
    const asset = await fetch(base + "/assets/test.js"); expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await asset.text()).toContain("export const test");
    const identity = await fetch(base + "/assets/test.js", { headers: { "Accept-Encoding": "gzip;q=0, identity" } }); expect(identity.headers.get("content-encoding")).toBeNull();
    for (const [extension, type] of Object.entries(extensions)) expect((await fetch(base + `/file.${extension}`)).headers.get("content-type")).toContain(type);
    const api = await fetch(base + "/api"); expect(api.status).toBe(404); expect(await api.json()).toEqual({ error: "API not found" });
  });
  it("starts both workers only after listening and cleans them up with signal listeners on close", async () => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-lifecycle-"));
    await writeFile(join(directory, "index.html"), "<html>SPA</html>");
    vi.stubEnv("PORT", "0"); vi.stubEnv("HOST", "127.0.0.1");
    const sigintCount = process.listenerCount("SIGINT"), sigtermCount = process.listenerCount("SIGTERM");
    const previousRejections = new Set(process.listeners("unhandledRejection"));
    server = startProductionServer(directory); await once(server, "listening");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = process.listeners("unhandledRejection").find(listener => !previousRejections.has(listener));
    rejection(Object.assign(new TypeError("private fixture message"), { code: "ERR_FIXTURE" }));
    expect(log).toHaveBeenCalledWith("[server] Unhandled promise rejection.", { name: "TypeError", code: "ERR_FIXTURE" });
    expect(log.mock.calls.flat().join(" ")).not.toContain("private fixture message");
    expect(startPerformanceScheduler).toHaveBeenCalledOnce(); expect(startRefreshAhead).toHaveBeenCalledOnce();
    const closed = once(server, "close"); server.close(); await closed; server = undefined;
    expect(startPerformanceScheduler.mock.results[0].value).toHaveBeenCalled(); expect(startRefreshAhead.mock.results[0].value).toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(sigintCount); expect(process.listenerCount("SIGTERM")).toBe(sigtermCount);
  });
  it("serves prerendered about, SPA routes, assets and shared API with security headers", async () => {
    directory = await mkdtemp(join(tmpdir(), "fe-prod-test-"));
    await mkdir(join(directory, "about"));
    await writeFile(join(directory, "index.html"), "<html>SPA</html>");
    await writeFile(join(directory, "about.html"), "<html>ABOUT</html>");
    await writeFile(join(directory, "about", "index.html"), "<html>ABOUT DIRECTORY</html>");
    await writeFile(join(directory, "app.js"), "export {};");
    await writeFile(join(directory, ".hidden"), "private fixture");
    server = createProductionServer(directory); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ["/about", "/about/", "/about.html", "/about/index.html"]) {
      const response = await fetch(base + path); expect(response.status).toBe(200); expect(await response.text()).toContain("ABOUT</html>");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
    expect(await (await fetch(base + "/stock/005930")).text()).toContain("SPA");
    expect((await fetch(base + "/app.js")).headers.get("content-type")).toContain("javascript");
    expect((await fetch(base + "/missing.js")).status).toBe(404);
    expect((await fetch(base + "/.hidden")).status).toBe(404);
    expect((await fetch(base + "/api/missing")).status).toBe(404);
    expect((await fetch(base + "/api/backend/status")).status).toBe(200);
    expect((await fetch(base + "/api/candidates/run", { method: "POST" })).status).toBe(401);
    expect((await fetch(base + "/app.js", { method: "HEAD" })).status).toBe(200);
    await rm(join(directory, "about.html"));
    expect(await (await fetch(base + "/about")).text()).toContain("ABOUT DIRECTORY");
  });
});
