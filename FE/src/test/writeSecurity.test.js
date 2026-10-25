// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRoutes, middlewareForRoutes } from "../../server/routes";
import { clientIp, createWriteLimiter, tokenMatches, validateDevelopmentAccess } from "../../server/writeSecurity";

describe("development host exposure", () => {
  it("rejects allowed remote hosts without admin or cron authentication", () => {
    for (const tokens of [{}, { ADMIN_API_TOKEN: "  ", CRON_SECRET: "\t" }]) {
      expect(() => validateDevelopmentAccess({ DEV_ALLOWED_HOSTS: "example.trycloudflare.com", ...tokens })).toThrow("DEV_ALLOWED_HOSTS requires ADMIN_API_TOKEN or CRON_SECRET");
    }
  });
  it("allows default local hosts and remote hosts with either credential", () => {
    expect(() => validateDevelopmentAccess({})).not.toThrow();
    expect(() => validateDevelopmentAccess({ DEV_ALLOWED_HOSTS: " , " })).not.toThrow();
    for (const name of ["ADMIN_API_TOKEN", "CRON_SECRET"]) {
      expect(() => validateDevelopmentAccess({ DEV_ALLOWED_HOSTS: "example.trycloudflare.com", [name]: "fixture-token" })).not.toThrow();
    }
  });
});

const env = { ADMIN_API_TOKEN: "fixture-admin", CRON_SECRET: "fixture-cron", PIPELINE_RUN_KIND: "official" };
function setup(config = env, options = {}) {
  const deps = { startCandidateAnalysis: vi.fn(() => ({ status: "running" })), getCandidateAnalysisStatus: vi.fn(() => ({ status: "idle" })),
    generateBriefingNarrative: vi.fn(async () => ({})), startPerformanceCollection: vi.fn(() => ({})), runPerformanceCollection: vi.fn(async () => ({})), refreshDashboardSnapshot: vi.fn(async () => ({ stocks: [], generatedAt: "fixture" })) };
  const routes = createRoutes(deps, config, options);
  async function call(path, token, extra = {}) {
    const headers = {}, res = { statusCode: 0, setHeader: (key, value) => { headers[key] = value; }, end: vi.fn() };
    await routes[path.split("?")[0]]({ method: "POST", url: path, socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost:5173", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...extra }, res);
    return { status: res.statusCode, headers };
  }
  return { deps, call };
}

describe("write authorization", () => {
  it.each(["/api/candidates/run", "/api/briefing/narrative", "/api/performance/collect"])("fails closed for %s before invoking providers", async path => {
    const { call, deps } = setup();
    expect((await call(path)).status).toBe(401);
    expect((await call(path, "wrong")).status).toBe(401);
    Object.values(deps).forEach(fn => expect(fn).not.toHaveBeenCalled());
    expect((await setup({}).call(path)).status).toBe(401);
    expect((await setup({ ADMIN_API_TOKEN: " ", CRON_SECRET: "" }).call(path, " ")).status).toBe(401);
  });
  it("reserves official runs for cron and overrides inherited official intent for admins", async () => {
    const { call, deps } = setup();
    expect((await call("/api/candidates/run?kind=official", "fixture-admin")).status).toBe(403);
    expect(deps.startCandidateAnalysis).not.toHaveBeenCalled();
    expect((await call("/api/candidates/run", "fixture-admin")).status).toBe(200);
    expect(deps.startCandidateAnalysis).toHaveBeenLastCalledWith({ ...env, PIPELINE_ANALYSIS_MODE: "model_only", PIPELINE_RUN_KIND: "adhoc" });
    expect((await call("/api/candidates/run?kind=official", "fixture-cron")).status).toBe(200);
    expect(deps.startCandidateAnalysis).toHaveBeenLastCalledWith({ ...env, PIPELINE_ANALYSIS_MODE: "model_only", PIPELINE_RUN_KIND: "official" });
  });
  it.each(["/api/briefing/narrative", "/api/performance/collect"])("accepts both credentials for %s", async path => {
    for (const token of ["fixture-admin", "fixture-cron"]) expect((await setup().call(path, token)).status).toBe(200);
  });
  it("allows local development only with no configured tokens and actual loopback peer", async () => {
    const { call } = setup({}, { development: true });
    for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect((await call("/api/candidates/run", null, { socket: { remoteAddress } })).status).toBe(200);
    expect((await call("/api/candidates/run?kind=official")).status).toBe(403);
    expect((await call("/api/candidates/run", null, { socket: { remoteAddress: "192.0.2.1" }, headers: { "x-forwarded-for": "127.0.0.1" } })).status).toBe(401);
    expect((await setup(env, { development: true }).call("/api/candidates/run")).status).toBe(401);
  });
  it("shares the ten-write window across routes and sends Retry-After", async () => {
    const { call } = setup();
    for (let index = 0; index < 10; index++) expect((await call(index % 2 ? "/api/briefing/narrative" : "/api/candidates/run")).status).toBe(401);
    const blocked = await call("/api/performance/collect");
    expect(blocked.status).toBe(429); expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
  });
  it("does not trust forwarded IPs by default and resets expired windows", () => {
    const request = { socket: { remoteAddress: "192.0.2.1" }, headers: { "x-forwarded-for": "198.51.100.2, 192.0.2.2" } };
    expect(clientIp(request, undefined)).toBe("192.0.2.1"); expect(clientIp(request, "1")).toBe("192.0.2.2");
    expect(clientIp(request, "2")).toBe("198.51.100.2");
    for (const hops of ["0", "-1", "1.5", "true", "3"]) expect(clientIp(request, hops)).toBe("192.0.2.1");
    let time = 0; const limit = createWriteLimiter(() => time, 1, 60000);
    expect(limit("a")).toBe(0); expect(limit("a")).toBe(60); expect(limit("b")).toBe(0);
    time = 60000; expect(limit("a")).toBe(0);
  });
  it("compares arbitrary token lengths and never accepts an empty configured token", () => {
    expect(tokenMatches("same", "same")).toBe(true); expect(tokenMatches("short", "much longer")).toBe(false);
    expect(tokenMatches("same", " same \n")).toBe(true);
    expect(tokenMatches("", "")).toBe(false); expect(tokenMatches(undefined, undefined)).toBe(false);
  });
  it.each([
    { host: "x.trycloudflare.com", "x-forwarded-for": "203.0.113.9" },
    { host: "localhost:5173", origin: "https://evil.example" },
    { host: "localhost:5173", origin: "http://localhost:5174" },
    { host: "localhost:5173", origin: "https://localhost:5173" },
    { host: "localhost:5173", origin: "null" },
    { host: "localhost:5173", "sec-fetch-site": "cross-site" },
    { host: "localhost:5173", "sec-fetch-site": "same-site" },
    { host: "x.trycloudflare.com" }, { host: "127.1:5173" }, {},
  ])("rejects tunneled or cross-site local requests with headers %j", async headers => {
    for (const path of ["/api/candidates/run", "/api/briefing/narrative", "/api/korean-market/refresh"]) {
      const { call, deps } = setup({}, { development: true });
      expect((await call(path, null, { socket: { remoteAddress: "::1" }, headers })).status).toBe(401);
      Object.values(deps).forEach(fn => expect(fn).not.toHaveBeenCalled());
    }
  });
  it.each(["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded", "cf-connecting-ip", "cf-ray"])("rejects presence of %s even on localhost", async header => {
    const { call } = setup({}, { development: true });
    expect((await call("/api/candidates/run", null, { headers: { host: "localhost:5173", [header]: "" } })).status).toBe(401);
  });
  it.each([
    { host: "localhost:5173", origin: "http://localhost:5173" },
    { host: "127.0.0.1:5173", "sec-fetch-site": "same-origin" },
    { host: "[::1]:5173", origin: "http://[::1]:5173" },
    { host: "localhost:5173", "sec-fetch-site": "none" },
    { host: "localhost:5173" },
  ])("keeps same-origin local development for %j", async headers => {
    const { call } = setup({}, { development: true });
    expect((await call("/api/briefing/narrative", null, { headers })).status).toBe(200);
  });
  it("keeps valid cron and admin requests independent of anonymous IP exhaustion", async () => {
    const { call, deps } = setup();
    for (let index = 0; index < 10; index++) expect((await call("/api/candidates/run")).status).toBe(401);
    expect((await call("/api/candidates/run")).status).toBe(429);
    expect((await call("/api/candidates/run?kind=official", "fixture-cron")).status).toBe(200);
    expect(deps.startCandidateAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({ PIPELINE_RUN_KIND: "official" }));
    expect((await call("/api/candidates/run", "fixture-admin")).status).toBe(200);
  });
  it("limits each authenticated role separately to thirty writes per minute", async () => {
    const { call } = setup();
    for (let index = 0; index < 30; index++) expect((await call("/api/briefing/narrative", "fixture-admin")).status).toBe(200);
    expect((await call("/api/briefing/narrative", "fixture-admin")).status).toBe(429);
    expect((await call("/api/briefing/narrative", "fixture-cron")).status).toBe(200);
    expect((await call("/api/briefing/narrative")).status).toBe(401);
  });
  it("ignores forged XFF prefixes before the configured trusted hops", async () => {
    const { call } = setup({ ...env, TRUST_PROXY: "1" });
    for (let index = 0; index < 11; index++) {
      const result = await call("/api/candidates/run", null, { headers: { "x-forwarded-for": `192.0.2.${index}, 203.0.113.9` } });
      expect(result.status).toBe(index < 10 ? 401 : 429);
    }
    const request = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "forged, 203.0.113.9, 192.0.2.2" } };
    expect(clientIp(request, "2")).toBe("203.0.113.9"); expect(clientIp(request, "3")).toBe("127.0.0.1");
  });
  it("evicts the oldest IP bucket at capacity instead of rejecting every new IP", () => {
    const limit = createWriteLimiter(() => 0, 1, 60000, 2);
    expect(limit("old")).toBe(0); expect(limit("recent")).toBe(0); expect(limit("old")).toBe(60);
    expect(limit("new")).toBe(0); expect(limit("recent")).toBe(60); expect(limit("old")).toBe(0);
  });
  it("scans expiry at most once per second while resetting an expired requesting IP immediately", () => {
    let time = 0;
    const limit = createWriteLimiter(() => time, 1, 100);
    const scan = vi.spyOn(Map.prototype, Symbol.iterator);
    limit("a");
    for (let index = 0; index < 100; index++) { time = index; limit("other"); }
    time = 500; const reset = limit("a");
    time = 1000; limit("a");
    const count = scan.mock.calls.length; scan.mockRestore();
    expect(count).toBe(2); expect(reset).toBe(0);
  });
  it("fails closed for production snapshot refresh without a key and shares the local rules", async () => {
    expect((await setup().call("/api/korean-market/refresh")).status).toBe(401);
    expect((await setup().call("/api/korean-market/refresh", "fixture-admin")).status).toBe(401);
    expect((await setup({}, { development: true }).call("/api/korean-market/refresh")).status).toBe(200);
    expect((await setup({ SNAPSHOT_REFRESH_KEY: " key " }).call("/api/korean-market/refresh?key=key")).status).toBe(200);
  });
  it("contains async route rejection and avoids changing already sent headers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const middleware = middlewareForRoutes({ "/api/fail": async () => { throw new Error("private fixture"); } });
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    middleware({ url: "/api/fail" }, response, vi.fn());
    await vi.waitFor(() => expect(response.statusCode).toBe(500));
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ error: "Internal server error" });
    const sent = { headersSent: true, setHeader: vi.fn(), end: vi.fn() };
    middleware({ url: "/api/fail" }, sent, vi.fn());
    await vi.waitFor(() => expect(sent.end).toHaveBeenCalled()); expect(sent.setHeader).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
