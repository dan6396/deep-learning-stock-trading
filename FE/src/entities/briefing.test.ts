import { describe, expect, it } from "vitest";
import {
  adaptBriefing,
  adaptBriefingComposition,
  adaptBriefingNarrative,
  adaptMacroData,
  adaptMacroIndicator,
  adaptMacroReference,
  citationDomId,
  formatFallbackReason,
  formatKstTime,
  formatMacroAsOf,
  formatMacroChange,
  formatMacroValue,
  formatNewsDate,
  parseCitation,
  withoutRankScoreDisclaimer,
} from "./briefing";

describe("adaptBriefing", () => {
  it.each(["official", "adhoc", "unknown", undefined, "invalid"])("normalizes run kind metadata (%s)", kind => {
    const model = { modelId: "fixture", scoreKind: "rank_zscore", baseDate: "2026-10-22", predictionTarget: "next_session_open_to_close", poolSize: 199, runStartedAt: "2026-10-22T07:00:00Z" };
    expect(adaptBriefing({ status: "ready", model, kind }).kind).toBe(kind === "official" || kind === "adhoc" ? kind : "unknown");
    expect(adaptBriefing({ status: "no_run", kind }).kind).toBe("unknown");
  });
  it("adapts full payload correctly", () => {
    const raw = {
      version: 1,
      status: "ready",
      model: {
        modelId: "model_v1",
        scoreKind: "rank_zscore",
        baseDate: "2026-10-23",
        predictionTarget: "next_session_open_to_close",
        poolSize: 200,
        runStartedAt: "2026-10-23T09:00:00Z",
      },
      macro: {
        asOf: "2026-10-23T15:30:00Z",
        context: {
          usSessionDate: "2026-10-22",
          targetSessionNote: "미국 증시 기술주 상승 마감 영향 관찰",
        },
        indicators: [
          {
            id: "KOSPI",
            name: "코스피",
            value: 2605.5,
            change: 12.3,
            changePct: 0.47,
            unit: "pt",
            asOf: "2026-10-23T15:30:00Z",
            source: "kis",
            status: "ok",
          },
          {
            id: "NASDAQ",
            name: "나스닥",
            value: 18000.1,
            change: -50.2,
            changePct: -0.28,
            unit: "pt",
            asOf: "2026-10-22T20:00:00Z",
            source: "yahoo",
            status: "ok",
            session: "closed",
          },
          {
            id: "UNKNOWN_ID",
            name: "알수없는 지표",
            value: 100,
            status: "ok",
          },
        ],
      },
      stocks: [
        {
          rank: 1,
          code: "005930",
          name: "삼성전자",
          rankScore: 2.14,
          poolSize: 200,
          topPercent: 0.5,
          evidence: [{ id: "E:005930:1", kind: "model", text: "상위 모멘텀 유지" }],
          cautions: [{ id: "C:005930:1", kind: "macro", text: "환율 변동 주의" }],
          news: {
            status: "collected",
            articles: [
              {
                id: "N:005930:1",
                title: "삼성전자 관련 기사",
                url: "https://news.example.com/1",
                source: "경제신문",
                pubDate: "2026-10-23T08:00:00Z",
              },
            ],
          },
        },
      ],
      narrative: {
        status: "llm",
        generatedAt: "2026-10-23T15:35:00Z",
        llmModel: "gemini-2.5-flash",
        inputHash: "abc123hash",
        fallbackReason: null,
        overview: "시장 요약 내용",
        marketNote: "매크로 요약 내용",
        stocks: [
          {
            code: "005930",
            summary: "삼성전자 분석 요약",
            citations: ["M:KOSPI", "E:005930:1"],
          },
        ],
        citations: ["M:KOSPI", "N:005930:1"],
      },
      disclaimer: "테스트 면책 조항",
      data_meta: { source: "live", asOf: "2026-10-23T15:30:00Z" },
    };

    const adapted = adaptBriefing(raw);
    expect(adapted.status).toBe("ready");
    expect(adapted.model?.modelId).toBe("model_v1");
    expect(adapted.model?.predictionTarget).toBe("next_session_open_to_close");
    expect(adapted.macro.context?.targetSessionNote).toBe("미국 증시 기술주 상승 마감 영향 관찰");
    expect(adapted.macro.context?.usSessionDate).toBe("2026-10-22");
    // 알 수 없는 지표 UNKNOWN_ID는 제외되어 indicators 길이가 2여야 함
    expect(adapted.macro.indicators).toHaveLength(2);
    expect(adapted.macro.indicators[1].session).toBe("closed");
    expect(adapted.stocks[0].code).toBe("005930");
    expect(adapted.stocks[0].evidence[0].text).toBe("상위 모멘텀 유지");
    expect(adapted.narrative.status).toBe("llm");
    expect(adapted.narrative.llmModel).toBe("gemini-2.5-flash");
    expect(adapted.disclaimer).toBe("테스트 면책 조항");
  });

  it("handles null, invalid and missing fields gracefully (contract test)", () => {
    const raw = {
      status: "invalid_status",
      macro: {
        // no context
        indicators: [
          {
            id: "UST10Y",
            value: null,
            change: null,
            changePct: null,
            status: "unavailable",
            // no session
          },
        ],
      },
      stocks: [
        {
          code: 5930, // number code normalization
          rank: null,
          evidence: null,
          cautions: null,
          news: null,
        },
      ],
      narrative: null,
    };

    const adapted = adaptBriefing(raw);
    expect(adapted.status).toBe("no_run");
    expect(adapted.model).toBeNull();
    expect(adapted.macro.context).toBeUndefined();
    expect(adapted.macro.indicators[0].id).toBe("UST10Y");
    expect(adapted.macro.indicators[0].status).toBe("unavailable");
    expect(adapted.macro.indicators[0].session).toBeUndefined();
    expect(adapted.stocks).toEqual([]);
    expect(adapted.narrative.status).toBe("template");
    expect(adapted.narrative.macroAsOf).toBeUndefined();
    expect(adapted.narrative.macroStale).toBeUndefined();
  });

  it("handles optional narrative fields macroAsOf and macroStale when present", () => {
    const raw = {
      narrative: {
        status: "llm",
        macroAsOf: "2026-10-23T15:30:00Z",
        macroStale: true,
      },
    };
    const adapted = adaptBriefing(raw);
    expect(adapted.narrative.macroAsOf).toBe("2026-10-23T15:30:00Z");
    expect(adapted.narrative.macroStale).toBe(true);
  });
});

describe("missing briefing facts", () => {
  it("removes only repeated rank-score boilerplate and preserves factual quantities", () => {
    expect(withoutRankScoreDisclaimer("전체 199개 중 2위(상위 1.01%)입니다. 순위 점수는 수익률·확률이 아닙니다.")).toBe("전체 199개 중 2위(상위 1.01%)입니다.");
    expect(withoutRankScoreDisclaimer("해당 점수는 기대수익률이나 상승 확률을 의미하지 않습니다.")).toBe("");
    expect(withoutRankScoreDisclaimer("수익률 자료는 없습니다. 순위 점수는 1.01입니다.")).toBe("수익률 자료는 없습니다. 순위 점수는 1.01입니다.");
  });
  it("excludes missing stock/article/narrative identities and preserves absent numeric facts as null", () => {
    const adapted = adaptBriefing({ stocks: [
      { code: "005930", name: "삼성전자", rank: 1, news: { articles: [
        { id: "N:005930:1", title: "공시", url: "https://example.com", source: "경제지" },
        { id: "N:005930:2", url: "https://example.com", source: "경제지" },
        { id: "N:005930:3", title: "공시", url: "https://example.com" },
      ] } }, { code: "000660", rank: 2 }, { code: "035420", name: "네이버" },
    ], narrative: { stocks: [{ summary: "식별자 없음" }, { code: "005930" }, { code: "005930", summary: "유효 서사" }] } });
    expect(adapted.stocks).toHaveLength(1);
    expect(adapted.stocks[0]).toMatchObject({ rank: 1, rankScore: null, poolSize: null, topPercent: null });
    expect(adapted.stocks[0].news.articles).toHaveLength(1);
    expect(adapted.narrative.stocks).toEqual([{ code: "005930", summary: "유효 서사", citations: [] }]);
    expect(JSON.stringify(adapted)).not.toMatch(/제목 없음|출처 미확인|000000/);
  });
});

describe("adaptMacroIndicator", () => {
  it("defaults unavailable if value is null even if status is ok", () => {
    const indicator = adaptMacroIndicator({
      id: "KOSPI",
      value: null,
      status: "ok",
    });
    expect(indicator?.status).toBe("unavailable");
  });

  it("supports open/closed session and omits if null/undefined", () => {
    const openInd = adaptMacroIndicator({ id: "NASDAQ", value: 18000, session: "open" });
    expect(openInd?.session).toBe("open");

    const closedInd = adaptMacroIndicator({ id: "SP500", value: 5000, session: "closed" });
    expect(closedInd?.session).toBe("closed");

    const noneInd = adaptMacroIndicator({ id: "KOSPI", value: 2600, session: null });
    expect(noneInd?.session).toBeUndefined();
  });

  it("returns null for unknown indicator id instead of forcing KOSPI", () => {
    const invalidInd = adaptMacroIndicator({ id: "UNKNOWN_IND", value: 100 });
    expect(invalidInd).toBeNull();
  });
});

describe("formatMacroValue & formatMacroChange", () => {
  it("formats unavailable indicators as 미수집", () => {
    const ind = adaptMacroIndicator({ id: "KOSPI", value: null, status: "unavailable" })!;
    expect(formatMacroValue(ind)).toBe("미수집");
    expect(formatMacroChange(ind)).toEqual({
      text: "미수집",
      signSymbol: "",
      direction: "unavailable",
    });
  });

  it("formats UST10Y as % and change as %p", () => {
    const upInd = adaptMacroIndicator({
      id: "UST10Y",
      value: 4.25,
      change: 0.05,
      changePct: 1.19,
      unit: "%",
      status: "ok",
    })!;
    expect(formatMacroValue(upInd)).toBe("4.25%");
    expect(formatMacroChange(upInd)).toEqual({
      text: "▲ 0.05%p",
      signSymbol: "▲",
      direction: "rise",
    });

    const downInd = adaptMacroIndicator({
      id: "UST10Y",
      value: 4.2,
      change: -0.05,
      unit: "%",
      status: "ok",
    })!;
    expect(formatMacroValue(downInd)).toBe("4.20%");
    expect(formatMacroChange(downInd)).toEqual({
      text: "▼ 0.05%p",
      signSymbol: "▼",
      direction: "fall",
    });
  });

  it("formats USDKRW with 원 unit and change with 원 and %", () => {
    const ind = adaptMacroIndicator({
      id: "USDKRW",
      value: 1385.5,
      change: -3.5,
      changePct: -0.25,
      unit: "KRW",
      status: "ok",
    })!;
    expect(formatMacroValue(ind)).toBe("1,385.50원");
    expect(formatMacroChange(ind)).toEqual({
      text: "▼ 3.50원 (-0.25%)",
      signSymbol: "▼",
      direction: "fall",
    });
  });

  it("formats index with pt unit and change with pt and %", () => {
    const ind = adaptMacroIndicator({
      id: "KOSPI",
      value: 2600.12,
      change: 15.2,
      changePct: 0.59,
      unit: "pt",
      status: "ok",
    })!;
    expect(formatMacroValue(ind)).toBe("2,600.12pt");
    expect(formatMacroChange(ind)).toEqual({
      text: "▲ 15.20pt (+0.59%)",
      signSymbol: "▲",
      direction: "rise",
    });
  });
});

describe("formatKstTime & formatNewsDate", () => {
  it("formats ISO timestamp to MM/DD HH:mm KST with h23", () => {
    const formatted = formatKstTime("2026-10-23T06:30:00Z");
    // 06:30 UTC = 15:30 KST
    expect(formatted).toBe("10/23 15:30 KST");
  });

  it("handles null/invalid date", () => {
    expect(formatKstTime(null)).toBe("시각 미확인");
    expect(formatKstTime("invalid-date")).toBe("시각 미확인");
  });

  it("formats news date including year when different from current year", () => {
    const pastDate = formatNewsDate("2020-05-10T02:00:00Z");
    expect(pastDate).toContain("2020");
  });
});

describe("formatFallbackReason", () => {
  it("maps server fallback reason codes to human readable Korean", () => {
    expect(formatFallbackReason("not_generated")?.text).toBe("아직 AI 요약을 생성하지 않았습니다");
    expect(formatFallbackReason("not_generated")?.isNeutral).toBe(true);

    expect(formatFallbackReason("generation_in_progress")?.text).toBe("AI 요약이 현재 생성 중입니다");
    expect(formatFallbackReason("generation_in_progress")?.isNeutral).toBe(true);

    expect(formatFallbackReason("missing_api_key")?.text).toBe("AI 요약 기능이 설정되지 않았습니다");
    expect(formatFallbackReason("missing_api_key")?.isNeutral).toBe(false);

    expect(formatFallbackReason("cooldown")?.text).toContain("쿨다운");

    expect(formatFallbackReason("forbidden_content")?.text).toContain("검증 기준을 통과하지 못해");
    expect(formatFallbackReason("generation_timeout")?.text).toContain("시간이 초과되어");
    expect(formatFallbackReason("generation_failed")?.text).toContain("생성에 실패하여");
    expect(formatFallbackReason("unexpected_server_code")?.text).toBe("규칙 기반 요약을 표시합니다");
  });
});

describe("citationDomId & parseCitation", () => {
  it("converts raw citation to safe DOM id", () => {
    expect(citationDomId("E:005930:1")).toBe("cite-E-005930-1");
    expect(citationDomId("M:KOSPI")).toBe("cite-M-KOSPI");
    expect(citationDomId("N:005930:1")).toBe("cite-N-005930-1");
    expect(citationDomId("R:005930")).toBe("cite-R-005930");
  });

  it("parses macro citation with Korean indicator name and unified targetElementId", () => {
    const parsed = parseCitation("M:KOSPI");
    expect(parsed.type).toBe("macro");
    expect(parsed.macroId).toBe("KOSPI");
    expect(parsed.targetElementId).toBe("cite-M-KOSPI");
    expect(parsed.label).toBe("코스피");
    expect(parsed.isValid).toBe(true);

    expect(parseCitation("M:KOSPI200_NIGHT").label).toBe("야간선물");
    expect(parseCitation("M:UST10Y").label).toBe("미 10년물");
    expect(parseCitation("M:INVALID").isValid).toBe(false);
  });

  it("parses news citation with Korean index and unified targetElementId", () => {
    const parsed = parseCitation("N:005930:1");
    expect(parsed.type).toBe("news");
    expect(parsed.code).toBe("005930");
    expect(parsed.index).toBe(1);
    expect(parsed.targetElementId).toBe("cite-N-005930-1");
    expect(parsed.label).toBe("기사 1");
    expect(parsed.isValid).toBe(true);

    expect(parseCitation("N:005930:invalid").isValid).toBe(false);
  });

  it("parses evidence, caution and rank citation with Korean index and unified targetElementId", () => {
    const ev = parseCitation("E:005930:2");
    expect(ev.targetElementId).toBe("cite-E-005930-2");
    expect(ev.label).toBe("근거 2");
    expect(ev.isValid).toBe(true);
    expect(parseCitation("E:005930:-1").isValid).toBe(false);
    expect(parseCitation("E:005930:0").isValid).toBe(false);

    const caution = parseCitation("C:005930:1");
    expect(caution.targetElementId).toBe("cite-C-005930-1");
    expect(caution.label).toBe("주의 1");
    expect(caution.isValid).toBe(true);

    const rank = parseCitation("R:005930");
    expect(rank.targetElementId).toBe("cite-R-005930");
    expect(rank.label).toBe("순위");
    expect(rank.isValid).toBe(true);
  });

  it("formats domestic macro asOf as 'MM/DD 종가' when after 15:30 KST", () => {
    // 20:05 KST -> 종가
    expect(formatMacroAsOf("KOSPI", "2026-10-22T20:05:00+09:00")).toBe("10/22 종가");
    expect(formatMacroAsOf("KOSDAQ", "2026-10-22T20:05:00+09:00")).toBe("10/22 종가");
    // 15:30 KST -> 종가
    expect(formatMacroAsOf("KOSPI", "2026-10-22T15:30:00+09:00")).toBe("10/22 종가");
    // 14:00 KST -> 시각 표시
    expect(formatMacroAsOf("KOSPI", "2026-10-22T14:00:00+09:00")).toBe("10/22 14:00 KST");
    // NASDAQ -> 시각 표시 유지
    expect(formatMacroAsOf("NASDAQ", "2026-10-23T02:01:00+09:00")).toBe("10/23 02:01 KST");
  });
});

describe("KOSPI200_NIGHT indicator adapter", () => {
  it("adapts KOSPI200_NIGHT with open and closed sessions", () => {
    const nightOpen = adaptMacroIndicator({
      id: "KOSPI200_NIGHT",
      name: "코스피200 야간선물",
      value: 350.25,
      change: 1.75,
      changePct: 0.5,
      unit: "pt",
      source: "kis",
      status: "ok",
      session: "open",
    });
    expect(nightOpen?.id).toBe("KOSPI200_NIGHT");
    expect(nightOpen?.name).toBe("코스피200 야간선물");
    expect(nightOpen?.session).toBe("open");
    expect(nightOpen?.value).toBe(350.25);

    const nightClosed = adaptMacroIndicator({
      id: "KOSPI200_NIGHT",
      value: 348.5,
      session: "closed",
      status: "ok",
    });
    expect(nightClosed?.session).toBe("closed");
    expect(nightClosed?.name).toBe("코스피200 야간선물");
  });
});

describe("adaptMacroReference", () => {
  it("adapts valid macro.reference and rows", () => {
    const raw = {
      title: "나스닥-국내 증시 조건부 통계",
      periodStart: "2024-01-01",
      periodEnd: "2026-10-22",
      lastObservedDate: "2026-10-22",
      rows: [
        {
          definition: "close_to_close",
          label: "나스닥 상승 익일 코스피 (전일 종가→종가)",
          condition: "nasdaq_up",
          ratioPct: 62.4,
          count: 146,
          total: 234,
          baselinePct: 51.2,
          ciLowPct: 55.8,
          ciHighPct: 68.7,
        },
        {
          definition: "open_to_close",
          label: "나스닥 상승 당일 코스피 (시가→종가)",
          condition: "nasdaq_up",
          ratioPct: 51.8,
          count: 121,
          total: 234,
          baselinePct: 50.9,
          ciLowPct: 45.2,
          ciHighPct: 58.3,
        },
      ],
      note: "나스닥 영향은 시가 갭에 주로 반영됩니다",
      source: "KRX · Yahoo Finance",
    };

    const ref = adaptMacroReference(raw);
    expect(ref).not.toBeNull();
    expect(ref?.title).toBe("나스닥-국내 증시 조건부 통계");
    expect(ref?.rows).toHaveLength(2);
    expect(ref?.rows[0].definition).toBe("close_to_close");
    expect(ref?.rows[0].ratioPct).toBe(62.4);
    expect(ref?.rows[1].definition).toBe("open_to_close");
  });

  it("handles null or invalid macro.reference gracefully", () => {
    expect(adaptMacroReference(null)).toBeNull();
    expect(adaptMacroReference(undefined)).toBeNull();
    expect(adaptMacroReference({})).toBeNull();
  });

  it("integrates into adaptMacroData when present or null", () => {
    const macroWithRef = adaptMacroData({
      asOf: "2026-10-23T06:30:00Z",
      indicators: [],
      reference: {
        title: "통계",
        rows: [],
      },
    });
    expect(macroWithRef.reference?.title).toBe("통계");

    const macroNullRef = adaptMacroData({
      asOf: "2026-10-23T06:30:00Z",
      indicators: [],
      reference: null,
    });
    expect(macroNullRef.reference).toBeNull();

    const macroWithoutRef = adaptMacroData({
      asOf: "2026-10-23T06:30:00Z",
      indicators: [],
    });
    expect(macroWithoutRef.reference).toBeUndefined();
  });
});

describe("adaptBriefingComposition", () => {
  it("adapts full composition object with contract fields (basis, sectorSource, positiveDays, asOf, averageReturnPct)", () => {
    const raw = {
      basis: "equal_weight_reference",
      note: "TOP5 후보는 동일 비중 포트폴리오를 가정합니다.",
      sectors: [
        {
          name: "반도체",
          codes: ["005930", "000660"],
        },
        {
          name: "자동차",
          codes: ["005380"],
        },
      ],
      sectorSource: "KRX",
      performance: {
        asOf: "2026-10-23T06:30:00Z",
        measuredDays: 45,
        averageReturnPct: 1.25,
        positiveDays: 28,
        recent: [
          { date: "2026-10-22", returnPct: 0.85 },
          { date: "2026-10-21", returnPct: -0.32 },
          { date: "invalid-date", returnPct: 1.0 }, // 날짜 형식 오류로 제외되어야 함
          { date: "2026-10-20", returnPct: "invalid" }, // 숫자 오류로 제외되어야 함
        ],
      },
      commonCautions: ["원/달러 환율 변동성 확대 주의", "개장 직후 외국인 수급 쏠림 관찰 필요"],
    };

    const comp = adaptBriefingComposition(raw);
    expect(comp).not.toBeNull();
    expect(comp?.basis).toBe("equal_weight_reference");
    expect(comp?.note).toBe("TOP5 후보는 동일 비중 포트폴리오를 가정합니다.");
    expect(comp?.sectorSource).toBe("KRX");
    expect(comp?.sectors).toHaveLength(2);
    expect(comp?.sectors?.[0].name).toBe("반도체");
    expect(comp?.sectors?.[0].codes).toEqual(["005930", "000660"]);
    expect(comp?.performance?.asOf).toBe("2026-10-23T06:30:00Z");
    expect(comp?.performance?.measuredDays).toBe(45);
    expect(comp?.performance?.averageReturnPct).toBe(1.25);
    expect(comp?.performance?.positiveDays).toBe(28);
    // 유효한 recent만 2개 남음
    expect(comp?.performance?.recent).toHaveLength(2);
    expect(comp?.performance?.recent[0]).toEqual({ date: "2026-10-22", returnPct: 0.85 });
    expect(comp?.commonCautions).toHaveLength(2);
  });

  it("retains null for sectors and averageReturnPct without replacing with defaults", () => {
    const raw = {
      basis: "equal_weight_reference",
      note: "안내 문구",
      sectors: null, // null 유지
      sectorSource: null,
      performance: {
        asOf: null,
        measuredDays: 10,
        averageReturnPct: null, // null 유지 (0으로 바꾸지 않음)
        positiveDays: 6,
        recent: [],
      },
      commonCautions: [],
    };

    const comp = adaptBriefingComposition(raw);
    expect(comp).not.toBeNull();
    expect(comp?.sectors).toBeNull();
    expect(comp?.performance?.averageReturnPct).toBeNull();
    expect(comp?.performance?.positiveDays).toBe(6);
  });

  it("handles measuredDays=0 or null performance", () => {
    const zeroPerf = adaptBriefingComposition({
      note: "안내 문구",
      sectors: [],
      performance: {
        asOf: null,
        measuredDays: 0,
        averageReturnPct: null,
        positiveDays: 0,
        recent: [],
      },
      commonCautions: [],
    });
    expect(zeroPerf?.performance?.measuredDays).toBe(0);

    const nullPerf = adaptBriefingComposition({
      note: "안내 문구",
      sectors: null,
      performance: null,
      commonCautions: [],
    });
    expect(nullPerf?.performance).toBeNull();
  });

  it("handles null or missing composition in adaptBriefing", () => {
    expect(adaptBriefingComposition(null)).toBeNull();
    expect(adaptBriefingComposition(undefined)).toBeNull();

    const briefingWithNullComp = adaptBriefing({
      status: "ready",
      composition: null,
    });
    expect(briefingWithNullComp.composition).toBeNull();

    const briefingWithoutComp = adaptBriefing({
      status: "ready",
    });
    expect(briefingWithoutComp.composition).toBeUndefined();
  });

  it("adapts narrative fieldSources and stock sources when present", () => {
    const raw = {
      status: "llm",
      generatedAt: "2026-10-23T09:00:00Z",
      llmModel: "gemini-flash",
      inputHash: "hash-123",
      fallbackReason: "partial_template",
      overview: "개황 요약",
      marketNote: "거시 지표 요약",
      stocks: [
        {
          code: "005930",
          summary: "종목 요약",
          citations: ["M:KOSPI"],
          source: "template",
        },
      ],
      citations: ["M:KOSPI"],
      fieldSources: {
        overview: "template",
        marketNote: "llm",
      },
    };

    const adapted = adaptBriefingNarrative(raw);
    expect(adapted.fallbackReason).toBe("partial_template");
    expect(adapted.fieldSources).toEqual({
      overview: "template",
      marketNote: "llm",
    });
    expect(adapted.stocks[0].source).toBe("template");
  });

  it("formats fallbackReason for partial_template correctly", () => {
    const res = formatFallbackReason("partial_template");
    expect(res).toEqual({
      text: "일부 문장이 검증 기준을 통과하지 못해 규칙 기반 문장으로 대체되었습니다",
      isNeutral: false,
    });
  });
});
