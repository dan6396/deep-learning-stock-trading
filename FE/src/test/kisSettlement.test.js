import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => { const mocks = { readFile: vi.fn(async () => { throw new Error("fixture has no disk cache"); }), writeFile: vi.fn(), mkdir: vi.fn() }; return { ...mocks, default: mocks }; });
vi.mock("../../server/pipelineResults", () => ({ loadPipelineRows: vi.fn(async () => null), indexPipelineByTicker: vi.fn() }));
const env = { KIS_ENV: "real", KIS_APP_KEY: "fixture-key", KIS_APP_SECRET: "fixture-secret", KIS_BASE_URL: "https://settlement-fixture.invalid", KIS_REQUEST_DELAY_MS: "1", PIPELINE_OUTPUT_DIR: "fixture-ledger" };
let api, requests;
const response = body => new Response(JSON.stringify(body));
beforeEach(async () => { vi.resetModules(); requests = []; api = await import("../../server/kisDashboard"); });
afterEach(() => vi.unstubAllGlobals());
function backend(reply) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("oauth2")) return response({ access_token: "fixture-token", expires_in: 3600 });
    requests.push({ url: new URL(url), options }); return response(reply(new URL(url)));
  }));
}
it("uses exact-day unadjusted OHLC and never takes another date", async () => {
  backend(() => ({ rt_cd: "0", output2: [{ stck_bsop_date: "20261008", stck_oprc: "100", stck_clpr: "110", acml_vol: "300" }, { stck_bsop_date: "20261007", stck_oprc: "1", stck_clpr: "2", acml_vol: "300" }] }));
  expect(await api.fetchKisSettlementPrice("005930", "2026-10-08", env)).toEqual({ date: "2026-10-08", open: 100, close: 110, volume: 300 });
  expect(requests[0].url.searchParams.get("FID_ORG_ADJ_PRC")).toBe("1");
  expect(requests[0].url.searchParams.get("FID_INPUT_DATE_1")).toBe("20261008");
});
it("rejects duplicate same-day observations and missing volume", async () => {
  const row = { stck_bsop_date: "20261008", stck_oprc: "100", stck_clpr: "110", acml_vol: "300" };
  backend(() => ({ rt_cd: "0", output2: [row, row] }));
  expect(await api.fetchKisSettlementPrice("005930", "2026-10-08", env)).toBeNull();
  backend(() => ({ rt_cd: "0", output2: [{ ...row, acml_vol: "" }] }));
  expect(await api.fetchKisSettlementPrice("005930", "2026-10-08", env)).toBeNull();
});
it("resolves weekends and holidays from a contiguous KIS calendar and caches it", async () => {
  backend(() => ({ rt_cd: "0", output: [8, 9, 10, 11, 12].map(day => ({ bass_dt: `202610${day.toString().padStart(2, "0")}`, opnd_yn: [8, 12].includes(day) ? "Y" : "N", tr_day_yn: [8, 12].includes(day) ? "Y" : "N" })) }));
  expect(await api.fetchKisTargetSession("2026-10-08", env)).toBe("2026-10-12");
  expect(await api.fetchKisTargetSession("2026-10-08", env)).toBe("2026-10-12");
  expect(requests).toHaveLength(1);
});
it("supports quote-only keys using actual KOSPI sessions and attempts the account calendar once a day", async () => {
  backend(url => url.pathname.includes("chk-holiday") ? { rt_cd: "1", msg1: "fixture calendar permission denied" }
    : { rt_cd: "0", output2: [{ stck_bsop_date: "20261007", bstp_nmix_prpr: "3000" }, { stck_bsop_date: "20261008", bstp_nmix_prpr: "3100" }] });
  expect(await api.fetchKisTargetSession("2026-10-07", env)).toBe("2026-10-08");
  expect(await api.fetchKisTargetSession("2026-10-08", env)).toBeNull();
  expect(requests.filter(row => row.url.pathname.includes("chk-holiday"))).toHaveLength(1);
});
it("does not infer a future session or use truncated history without the base date", async () => {
  backend(url => url.pathname.includes("chk-holiday") ? { rt_cd: "0", output: [] }
    : { rt_cd: "0", output2: [{ stck_bsop_date: "20261008", bstp_nmix_prpr: "3100" }] });
  expect(await api.fetchKisTargetSession("2026-10-07", env)).toBeNull();
});
