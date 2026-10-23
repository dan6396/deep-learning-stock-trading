import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipelineProjectRoot } from "./pipelineFreshness";
declare const process: { env: Record<string, string | undefined> };

export type MacroReference = {
  title: "직전 미국장(나스닥) 방향과 코스피"; periodStart: string; periodEnd: string; lastObservedDate: string;
  rows: { definition: "close_to_close" | "open_to_close"; label: string; condition: "nasdaq_up" | "nasdaq_down";
    ratioPct: number; count: number; total: number; baselinePct: number; ciLowPct: number | null; ciHighPct: number | null }[];
  note: string; source: "Yahoo Finance 일봉, 팀 재검증(2026-10-23)";
};
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const percent = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
export function parseNasdaqReference(value: any): MacroReference | null {
  try {
    if (value?.schema_version !== 1 || !Array.isArray(value.periods)) return null;
    const period = value.periods.find((item: any) => item.name === "requested");
    if (!period || !validDate(period.start) || !validDate(period.end) || Math.abs(Date.parse(period.end) - Date.parse(period.start) - 365 * 86_400_000) > 2 * 86_400_000) return null;
    const aligned = period.alignments?.latest_prior;
    if (!aligned || !validDate(aligned.last_kospi_date) || aligned.last_kospi_date > period.end || aligned.last_kospi_date < period.start) return null;
    const rows: MacroReference["rows"] = [];
    for (const definition of ["close_to_close", "open_to_close"] as const) {
      const metrics = aligned.definitions?.[definition]?.metrics;
      for (const condition of ["nasdaq_up", "nasdaq_down"] as const) {
        const up = condition === "nasdaq_up", measured = metrics?.[up ? "kospi_up_given_nasdaq_up" : "kospi_down_given_nasdaq_down"];
        const baseline = metrics?.[up ? "kospi_up_baseline" : "kospi_down_baseline"];
        if (!measured || measured.unit !== "percent" || !percent(measured.value) || !Number.isInteger(measured.numerator) || !Number.isInteger(measured.denominator)
          || measured.denominator <= 0 || measured.numerator < 0 || measured.numerator > measured.denominator
          || Math.abs(measured.value - measured.numerator / measured.denominator * 100) > 1e-6 || !percent(baseline?.value)) return null;
        const ci = measured.ci95;
        if (ci !== null && (!Array.isArray(ci) || ci.length !== 2 || !ci.every(percent) || ci[0] > ci[1])) return null;
        rows.push({ definition, label: `${definition === "close_to_close" ? "전일 종가→종가" : "시가→종가"} · 나스닥 ${up ? "상승 뒤 코스피 상승" : "하락 뒤 코스피 하락"}`,
          condition, ratioPct: measured.value, count: measured.numerator, total: measured.denominator, baselinePct: baseline.value,
          ciLowPct: ci?.[0] ?? null, ciHighPct: ci?.[1] ?? null });
      }
    }
    const describe = (definition: "close_to_close" | "open_to_close", label: string) => {
      const measured = rows.filter(row => row.definition === definition);
      const distinct = measured.filter(row => row.ciLowPct !== null && row.ciHighPct !== null
        && (row.ratioPct > row.baselinePct && row.ciLowPct > row.baselinePct
          || row.ratioPct < row.baselinePct && row.ciHighPct < row.baselinePct));
      if (!distinct.length && measured.some(row => row.ciLowPct === null || row.ciHighPct === null)) return `${label}에서는 신뢰구간 자료가 부족해 기준선과의 차이를 판단하기 어렵습니다.`;
      return distinct.length ? `${label}에서는 ${distinct.map(row => `나스닥 ${row.condition === "nasdaq_up" ? "상승" : "하락"} 조건의 관측 비율이 같은 기간 기준선보다 ${row.ratioPct > row.baselinePct ? "높게" : "낮게"}`).join(", ")} 관찰됐습니다.`
        : `${label}에서는 같은 기간 기준선과 뚜렷한 차이가 관찰되지 않았습니다.`;
    };
    const note = `${describe("close_to_close", "시가 갭을 포함한 전일 종가→종가 구간")} ${describe("open_to_close", "모델 예측 구간인 시가→종가 구간")} 과거 통계이며 예측을 보장하지 않습니다.`;
    return { title: "직전 미국장(나스닥) 방향과 코스피", periodStart: period.start, periodEnd: period.end, lastObservedDate: aligned.last_kospi_date,
      rows, note, source: "Yahoo Finance 일봉, 팀 재검증(2026-10-23)" };
  } catch { return null; }
}
const loaded = new Map<string, Promise<MacroReference | null>>();
export function getNasdaqReference(env = process.env): Promise<MacroReference | null> {
  const path = join(pipelineProjectRoot(env), "materials", "reports", "macro-nasdaq-kospi", "result.json");
  if (!loaded.has(path)) loaded.set(path, readFile(path, "utf8").then(text => text.length < 5_000_000 ? parseNasdaqReference(JSON.parse(text)) : null).catch(() => null));
  return loaded.get(path)!.then(value => structuredClone(value));
}
