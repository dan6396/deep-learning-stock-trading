import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BriefingPayload } from "../../entities/briefing";
import { adaptBriefing } from "../../entities/briefing";
import { BriefingMacroGrid } from "./BriefingMacroGrid";
import { BriefingNarrativeCard } from "./BriefingNarrativeCard";
import { BriefingStockSection } from "./BriefingStockSection";
import { BriefingTopContainer, highlightCitationTarget } from "./BriefingTopContainer";
import { expectReadableUserText } from "../../test/assertUserText";

const mockBriefingData: BriefingPayload = {
  version: 1,
  status: "ready",
  model: {
    modelId: "ensemble_v2",
    scoreKind: "rank_zscore",
    baseDate: "2026-10-23",
    predictionTarget: "next_session_open_to_close",
    poolSize: 200,
    runStartedAt: "2026-10-23T08:30:00Z",
  },
  macro: {
    asOf: "2026-10-23T06:30:00Z", // 15:30 KST
    context: {
      usSessionDate: "2026-10-22",
      targetSessionNote: "전일 미국 증시 반도체 강세 마감 영향 관찰",
    },
    indicators: [
      {
        id: "KOSPI",
        name: "코스피",
        value: 2605.5,
        change: 15.2,
        changePct: 0.59,
        unit: "pt",
        asOf: "2026-10-23T06:30:00Z",
        source: "kis",
        status: "ok",
      },
      {
        id: "KOSDAQ",
        name: "코스닥",
        value: 850.1,
        change: -3.4,
        changePct: -0.4,
        unit: "pt",
        asOf: "2026-10-23T06:30:00Z",
        source: "kis",
        status: "ok",
      },
      {
        id: "NASDAQ",
        name: "나스닥",
        value: 18100.5,
        change: 120.4,
        changePct: 0.67,
        unit: "pt",
        asOf: "2026-10-22T20:00:00Z",
        source: "yahoo",
        status: "ok",
        session: "closed",
      },
      {
        id: "SP500",
        name: "S&P 500",
        value: 5800.2,
        change: 25.1,
        changePct: 0.43,
        unit: "pt",
        asOf: "2026-10-22T20:00:00Z",
        source: "yahoo",
        status: "ok",
        session: "open",
      },
      {
        id: "USDKRW",
        name: "원/달러 환율",
        value: 1385.5,
        change: -4.5,
        changePct: -0.32,
        unit: "KRW",
        asOf: "2026-10-23T06:30:00Z",
        source: "kis",
        status: "ok",
      },
      {
        id: "UST10Y",
        name: "미국채 10년물",
        value: 4.25,
        change: 0.05,
        changePct: 1.19,
        unit: "%",
        asOf: "2026-10-22T20:00:00Z",
        source: "yahoo",
        status: "ok",
      },
    ],
  },
  stocks: [
    {
      rank: 1,
      code: "005930",
      name: "삼성전자",
      rankScore: 2.34,
      poolSize: 200,
      topPercent: 0.5,
      evidence: [
        { id: "E:005930:1", kind: "model", text: "외국인 자금 순유입 지속 및 반도체 업종 모멘텀 유지" },
        { id: "E:005930:2", kind: "supply", text: "기관 3영업일 연속 자금 유입 관찰" },
      ],
      cautions: [
        { id: "C:005930:1", kind: "macro", text: "환율 급변동 및 미 국채 금리 추이 주시 필요" },
      ],
      news: {
        status: "collected",
        articles: [
          {
            id: "N:005930:1",
            title: "삼성전자, HBM 공급 확대 기대감",
            url: "https://news.example.com/samsung/1",
            source: "전자신문",
            pubDate: "2026-10-23T01:00:00Z",
          },
        ],
      },
    },
    {
      rank: 2,
      code: "000660",
      name: "SK하이닉스",
      rankScore: 1.95,
      poolSize: 200,
      topPercent: 1.0,
      evidence: [
        { id: "E:000660:1", kind: "model", text: "고대역폭 메모리 실적 호조 영향" },
      ],
      cautions: [
        { id: "C:000660:1", kind: "supply", text: "단기 급등에 따른 차익 실현 물량 출회 가능성" },
      ],
      news: {
        status: "collected",
        articles: [
          {
            id: "N:000660:1",
            title: "SK하이닉스 사상 최대 분기 영업익 달성",
            url: "https://news.example.com/sk/1",
            source: "매일경제",
            pubDate: "2026-10-23T00:30:00Z",
          },
        ],
      },
    },
  ],
  narrative: {
    status: "llm",
    generatedAt: "2026-10-23T06:35:00Z",
    llmModel: "gemini-2.5-flash",
    inputHash: "hash-ready-1",
    fallbackReason: null,
    overview: "미국 증시 기술주 강세에 힘입어 국내 반도체 대형주 중심의 우호적인 분위기가 형성되었습니다.",
    marketNote: "원/달러 환율이 하향 안정세를 보이며 외국인 수급에 긍정적인 환경을 제공하고 있습니다.",
    stocks: [
      {
        code: "005930",
        summary: "외국인 자금 유입과 HBM 모멘텀이 맞물리며 모델 최상위 순위를 기록했습니다.",
        citations: ["M:KOSPI", "E:005930:1"],
      },
      {
        code: "000660",
        summary: "실적 호조를 바탕으로 상위권을 유지하고 있으나 단기 변동성에 유의할 필요가 있습니다.",
        citations: ["M:NASDAQ", "C:000660:1"],
      },
    ],
    citations: ["M:KOSPI", "M:NASDAQ", "E:005930:1", "N:005930:1", "R:005930"],
    macroAsOf: "2026-10-23T06:30:00Z",
    macroStale: false,
  },
  disclaimer: "본 브리핑의 모델 순위 점수와 AI 요약은 투자 권유가 아니며 실제 수익률과 다를 수 있습니다.",
  data_meta: { source: "live", asOf: "2026-10-23T06:30:00Z" },
};

describe("BriefingMacroGrid", () => {
  it("renders all 6 indicators with correct formatting, sessions and context note", () => {
    render(<BriefingMacroGrid macro={mockBriefingData.macro} />);

    // Context note
    expect(screen.getByText("미국장 관측일 2026-10-22 · 지표별 기준 시각 참고")).toBeInTheDocument();
    expect(screen.queryByText(mockBriefingData.macro.context!.targetSessionNote)).not.toBeInTheDocument();

    // KOSPI
    expect(screen.getByTestId("macro-value-KOSPI")).toHaveTextContent("2,605.50pt");
    expect(screen.getByTestId("macro-change-KOSPI")).toHaveTextContent("상승 15.20pt (+0.59%)");

    // UST10Y (% value and %p change)
    expect(screen.getByTestId("macro-value-UST10Y")).toHaveTextContent("4.25%");
    expect(screen.getByTestId("macro-change-UST10Y")).toHaveTextContent("상승 0.05%p");

    // USDKRW (원 unit)
    expect(screen.getByTestId("macro-value-USDKRW")).toHaveTextContent("1,385.50원");
    expect(screen.getByTestId("macro-change-USDKRW")).toHaveTextContent("하락 4.50원 (-0.32%)");

    // 권장 4: session === "closed"이고 context.usSessionDate가 있으면 "10/22 미국장 종가", session === "open"이면 "미국 장중"
    expect(screen.getByText("10/22 미국장 종가")).toBeInTheDocument();
    expect(screen.getByText("미국 장중")).toBeInTheDocument();
  });

  it("handles unavailable indicators without displaying asOf time", () => {
    const unavailableMacro: typeof mockBriefingData.macro = {
      asOf: null,
      indicators: [
        {
          id: "UST10Y",
          name: "미국채 10년물",
          value: null,
          change: null,
          changePct: null,
          unit: "%",
          asOf: null,
          source: "yahoo",
          status: "unavailable",
        },
      ],
    };

    render(<BriefingMacroGrid macro={unavailableMacro} />);
    expect(screen.queryByTestId("macro-card-UST10Y")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("시장 지표를 불러오지 못했습니다");
  });
});

describe("BriefingNarrativeCard", () => {
  it("renders LLM narrative badge, macroAsOf and disabled button when fresh", () => {
    const onGenerate = vi.fn();
    const onCitationClick = vi.fn();

    render(
      <BriefingNarrativeCard
        narrative={mockBriefingData.narrative}
        stocks={mockBriefingData.stocks}
        isGenerating={false}
        generateError={null}
        onGenerate={onGenerate}
        onCitationClick={onCitationClick}
      />
    );

    // AI Badge
    expect(screen.getByTestId("narrative-badge-ai")).toHaveTextContent("AI 요약");
    expect(screen.getByText("입력 자료만 요약하며 순위에 영향을 주지 않습니다")).toBeInTheDocument();
    expect(screen.getByTestId("narrative-macro-as-of")).toHaveTextContent("요약에 쓴 지표 시점 10/23 15:30 KST");
    expect(screen.getByTestId("narrative-macro-as-of")).toHaveAttribute("title", "지표별 기준 시각은 시장 지표 카드 참고");
    expect(screen.getByTestId("narrative-macro-as-of")).not.toHaveTextContent("지표별 기준 시각은 시장 지표 카드 참고");

    // Fresh LLM button is disabled "생성됨"
    const btn = screen.getByTestId("narrative-generate-btn");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("생성됨");
  });

  it("renders mapped fallbackReason when template and activates button when macroStale", () => {
    const staleNarrative: typeof mockBriefingData.narrative = {
      ...mockBriefingData.narrative,
      status: "template",
      fallbackReason: "generation_timeout",
      macroStale: true,
    };

    const onGenerate = vi.fn();
    render(
      <BriefingNarrativeCard
        narrative={staleNarrative}
        stocks={mockBriefingData.stocks}
        isGenerating={false}
        generateError={null}
        onGenerate={onGenerate}
        onCitationClick={vi.fn()}
      />
    );

    expect(screen.getByTestId("narrative-badge-rule")).toHaveTextContent("자동 생성 요약");
    // 권장 5: generation_timeout 매핑 텍스트 확인
    expect(screen.getByText("AI 요약 생성 시간이 초과되어 규칙 기반 요약을 표시합니다")).toBeInTheDocument();
    expect(screen.getByText("요약 작성 이후 시장 지표가 갱신되었습니다")).toBeInTheDocument();

    const btn = screen.getByTestId("narrative-generate-btn");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("최신 지표로 다시 생성");

    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("displays neutral notice for not_generated fallback reason", () => {
    const notGenNarrative: typeof mockBriefingData.narrative = {
      ...mockBriefingData.narrative,
      status: "template",
      fallbackReason: "not_generated",
    };

    render(
      <BriefingNarrativeCard
        narrative={notGenNarrative}
        stocks={mockBriefingData.stocks}
        isGenerating={false}
        generateError={null}
        onGenerate={vi.fn()}
        onCitationClick={vi.fn()}
      />
    );

    const neutralNotice = screen.getByText("아직 AI 요약을 생성하지 않았습니다");
    expect(neutralNotice).toBeInTheDocument();
    expect(neutralNotice.closest(".is-neutral")).not.toBeNull();
  });

  it("displays refresh failure notice when status is llm with fallbackReason", () => {
    const refreshFailNarrative: typeof mockBriefingData.narrative = {
      ...mockBriefingData.narrative,
      status: "llm",
      fallbackReason: "cooldown",
      macroStale: true,
    };

    render(
      <BriefingNarrativeCard
        narrative={refreshFailNarrative}
        stocks={mockBriefingData.stocks}
        isGenerating={false}
        generateError={null}
        onGenerate={vi.fn()}
        onCitationClick={vi.fn()}
      />
    );

    // 권장 6: LLM 상태 유지 + 갱신 실패 안내
    expect(screen.getByText(/최신 지표로 갱신하지 못했습니다: 최근 생성 요청 후 쿨다운 중입니다/)).toBeInTheDocument();
  });

  it("prevents consecutive clicks by disabling button while generating and displays 1-minute hint", () => {
    const onGenerate = vi.fn();
    const { rerender } = render(
      <BriefingNarrativeCard
        narrative={{ ...mockBriefingData.narrative, macroStale: true }}
        stocks={mockBriefingData.stocks}
        isGenerating={true}
        generateError="서버 연결 오류"
        onGenerate={onGenerate}
        onCitationClick={vi.fn()}
      />
    );

    const btn = screen.getByTestId("narrative-generate-btn");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent("요약 생성 중...");
    expect(screen.getByText("서버 연결 오류")).toBeInTheDocument();

    // 생성 중 보조 문구 검증
    expect(screen.getByTestId("narrative-generating-hint")).toHaveTextContent(
      "최대 1분 정도 걸릴 수 있습니다"
    );

    fireEvent.click(btn);
    expect(onGenerate).not.toHaveBeenCalled();

    // 생성 완료(isGenerating=false) 후에는 보조 문구가 사라짐을 검증
    rerender(
      <BriefingNarrativeCard
        narrative={{ ...mockBriefingData.narrative, macroStale: false }}
        stocks={mockBriefingData.stocks}
        isGenerating={false}
        generateError={null}
        onGenerate={onGenerate}
        onCitationClick={vi.fn()}
      />
    );
    expect(screen.queryByTestId("narrative-generating-hint")).not.toBeInTheDocument();
  });
});

describe("BriefingStockSection", () => {
  it("renders stock cards, evidence, cautions and citations below summary", () => {
    const onSelectStock = vi.fn();
    const onCitationClick = vi.fn();

    render(
      <MemoryRouter>
        <BriefingStockSection
          stocks={mockBriefingData.stocks}
          narrative={mockBriefingData.narrative}
          selectedCode="005930"
          onSelectStock={onSelectStock}
          onCitationClick={onCitationClick}
        />
      </MemoryRouter>
    );

    // 삼성전자 rank, score, topPercent
    expect(screen.getByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText(/순위 점수: 2.3400/)).toBeInTheDocument();
    expect(screen.getByText(/200종목 중 상위 0.5%/)).toBeInTheDocument();

    // Summary
    expect(screen.getByText(/외국인 자금 유입과 HBM 모멘텀이 맞물리며/)).toBeInTheDocument();

    // 기본 접힌 상태: 요약 칩만 노출, 상세 근거·주의·인용 칩은 미노출
    expect(screen.getByTestId("stock-chip-evidence-005930")).toHaveTextContent("근거 2건");
    expect(screen.getByTestId("stock-citation-chip-M:KOSPI")).not.toBeVisible();

    // 자세히 버튼 클릭으로 펼침
    fireEvent.click(screen.getByTestId("stock-expand-btn-005930"));

    // 차단 2: 펼친 후 종목 요약 아래 citations 칩 확인
    const stockChip = screen.getByTestId("stock-citation-chip-M:KOSPI");
    expect(stockChip).toBeInTheDocument();
    fireEvent.click(stockChip);
    expect(onCitationClick).toHaveBeenCalledWith("M:KOSPI");

    // Evidence with unified DOM id
    const evItem = screen.getByTestId("evidence-E:005930:1");
    expect(evItem).toHaveAttribute("id", "cite-E-005930-1");

    // Caution with unified DOM id
    const cautionItem = screen.getByTestId("caution-C:005930:1");
    expect(cautionItem).toHaveAttribute("id", "cite-C-005930-1");

    // News with safe link and unified DOM id
    const newsLink = screen.getByRole("link", { name: /삼성전자, HBM 공급 확대 기대감 \(새 탭에서 열림\)/ });
    expect(newsLink).toHaveAttribute("href", "https://news.example.com/samsung/1");
    expect(screen.getByTestId("news-N:005930:1")).toHaveAttribute("id", "cite-N-005930-1");
  });

  it("toggles card folding with '자세히'/'접기' button and limits news to 3 articles", () => {
    const stockWithManyArticles = {
      ...mockBriefingData.stocks[0],
      code: "005930",
      news: {
        status: "collected" as const,
        articles: [
          { id: "N:005930:1", title: "기사 1", url: "https://example.com/1", source: "언론사1", pubDate: "2026-10-22T08:00:00Z" },
          { id: "N:005930:2", title: "기사 2", url: "https://example.com/2", source: "언론사2", pubDate: "2026-10-22T08:10:00Z" },
          { id: "N:005930:3", title: "기사 3", url: "https://example.com/3", source: "언론사3", pubDate: "2026-10-22T08:20:00Z" },
          { id: "N:005930:4", title: "기사 4", url: "https://example.com/4", source: "언론사4", pubDate: "2026-10-22T08:30:00Z" },
        ],
      },
    };

    render(
      <MemoryRouter>
        <BriefingStockSection
          stocks={[stockWithManyArticles]}
          narrative={mockBriefingData.narrative}
          selectedCode={null}
          onSelectStock={vi.fn()}
        />
      </MemoryRouter>
    );

    // 기본 접힘 상태: 자세히 버튼 aria-expanded="false"
    const toggleBtn = screen.getByTestId("stock-expand-btn-005930");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn).toHaveTextContent("자세히");

    // 요약 칩 표시
    expect(screen.getByTestId("stock-chip-evidence-005930")).toHaveTextContent("근거 2건");
    expect(screen.getByTestId("stock-chip-caution-005930")).toHaveTextContent("주의 1건");
    expect(screen.getByTestId("stock-chip-news-005930")).toHaveTextContent("기사 4건");

    // 세부 내용 미노출
    expect(screen.getByTestId("stock-details-005930")).not.toBeVisible();
    expect(document.getElementById(toggleBtn.getAttribute("aria-controls")!)).not.toBeNull();
    expect(screen.getByTestId("stock-chip-evidence-005930").tagName).toBe("SPAN");

    // 자세히 클릭 -> 펼침
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    expect(toggleBtn).toHaveTextContent("접기");
    expect(screen.getByTestId("stock-details-005930")).toBeInTheDocument();

    // 기사 최대 3건만 표시
    expect(screen.getByText("기사 1")).toBeInTheDocument();
    expect(screen.getByText("기사 2")).toBeInTheDocument();
    expect(screen.getByText("기사 3")).toBeInTheDocument();
    expect(screen.queryByText("기사 4")).not.toBeInTheDocument();

    // 다시 클릭 -> 접힘
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("stock-details-005930")).not.toBeVisible();
  });
});

describe("Citation DOM ID Navigation (차단 사항 1 실제 DOM 검증)", () => {
  let scrollMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls and highlights target DOM elements for E, C, N, M, R citations", () => {
    const { container } = render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={mockBriefingData}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    // 종합 카드에는 M과 R만 존재하고 E, N 등은 종합 카드에 없음
    expect(screen.getByTestId("citation-chip-M:KOSPI")).toBeInTheDocument();
    expect(screen.getByTestId("citation-chip-M:NASDAQ")).toBeInTheDocument();
    const rankChip = screen.getByTestId("citation-chip-R:005930");
    expect(rankChip).toBeInTheDocument();
    expect(rankChip).toHaveTextContent("삼성전자"); // R: 칩 라벨은 종목명
    expect(screen.queryByTestId("citation-chip-E:005930:1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("citation-chip-N:005930:1")).not.toBeInTheDocument();

    // 1. M:KOSPI 테스트 (매크로 카드는 항상 노출)
    fireEvent.click(screen.getByTestId("citation-chip-M:KOSPI"));
    highlightCitationTarget("M:KOSPI");
    const macroEl = container.querySelector("#cite-M-KOSPI");
    expect(macroEl).not.toBeNull();
    expect(macroEl).toHaveClass("briefing-highlight");
    expect(scrollMock).toHaveBeenCalled();

    // 2. R:005930 테스트 (종합 카드에서 종목 클릭 시 종목 카드 자동 펼침 및 하이라이트)
    fireEvent.click(rankChip);
    highlightCitationTarget("R:005930");
    const rankEl = container.querySelector("#cite-R-005930");
    expect(rankEl).not.toBeNull();
    expect(rankEl).toHaveClass("briefing-highlight");

    // 3. E:005930:1 테스트 (종목 카드 내부의 칩 클릭 시 하이라이트)
    const stockEvChip = screen.getByTestId("stock-citation-chip-E:005930:1");
    expect(stockEvChip).toBeInTheDocument();
    expect(stockEvChip).toHaveTextContent("근거 1"); // 종목별 카드 칩 라벨은 "근거 1" 유지
    fireEvent.click(stockEvChip);
    highlightCitationTarget("E:005930:1");
    const evEl = container.querySelector("#cite-E-005930-1");
    expect(evEl).not.toBeNull();
    expect(evEl).toHaveClass("briefing-highlight");

    // 4. C:005930:1 테스트 (주의점 하이라이트)
    highlightCitationTarget("C:005930:1");
    const cautionEl = container.querySelector("#cite-C-005930-1");
    expect(cautionEl).not.toBeNull();
    expect(cautionEl).toHaveClass("briefing-highlight");

    // 5. N:005930:1 테스트 (기사 링크 하이라이트)
    highlightCitationTarget("N:005930:1");
    const newsEl = container.querySelector("#cite-N-005930-1");
    expect(newsEl).not.toBeNull();
    expect(newsEl).toHaveClass("briefing-highlight");
  });
});

describe("Prohibited Terms Check (차단 사항 검증)", () => {
  it("does not contain any prohibited terms in rendered text", () => {
    const { container } = render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={mockBriefingData}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    const fullText = container.textContent ?? "";
    const PROHIBITED_PATTERN =
      /매수\s*권유|추천\b|목표가|상승\s*예상|확률|비중\s*확대|비중\s*축소|최적\s*비중|추천\s*비중|비중을\s*늘|비중을\s*줄/;

    const match = fullText.match(PROHIBITED_PATTERN);
    if (match) {
      throw new Error(`차단된 표현 '${match[0]}'이 발견되었습니다: ${fullText.slice(Math.max(0, match.index! - 20), match.index! + 30)}`);
    }
    expect(match).toBeNull();
  });
});

const mockExtendedBriefingData: BriefingPayload = {
  ...mockBriefingData,
  stocks: [
    {
      ...mockBriefingData.stocks[0],
      evidence: [
        { id: "E:005930:1", kind: "model", text: "외국인 5영업일 연속 순매수 지속 및 반도체 업종 모멘텀 유지" },
        { id: "E:005930:2", kind: "supply", text: "기관 3영업일 연속 자금 유입 관찰" },
      ],
    },
    ...mockBriefingData.stocks.slice(1),
  ],
  macro: {
    ...mockBriefingData.macro,
    indicators: [
      ...mockBriefingData.macro.indicators,
      {
        id: "KOSPI200_NIGHT",
        name: "코스피200 야간선물",
        value: 362.4,
        change: 1.15,
        changePct: 0.32,
        unit: "pt",
        asOf: "2026-10-23T01:30:00Z",
        source: "kis",
        status: "ok",
        session: "open",
      },
    ],
    reference: {
      title: "직전 미국장(나스닥) 방향과 코스피",
      periodStart: "2025-10-22",
      periodEnd: "2026-10-22",
      lastObservedDate: "2026-10-20",
      rows: [
        {
          definition: "close_to_close",
          label: "전일 종가→종가 · 나스닥 상승 뒤 코스피 상승",
          condition: "nasdaq_up",
          ratioPct: 73.2824427480916,
          count: 96,
          total: 131,
          baselinePct: 60.90534979423868,
          ciLowPct: 66.66666666666666,
          ciHighPct: 79.62962962962963,
        },
        {
          definition: "close_to_close",
          label: "전일 종가→종가 · 나스닥 하락 뒤 코스피 하락",
          condition: "nasdaq_down",
          ratioPct: 53.57142857142857,
          count: 60,
          total: 112,
          baselinePct: 39.09465020576132,
          ciLowPct: 44.44444444444444,
          ciHighPct: 62.502385496183194,
        },
        {
          definition: "open_to_close",
          label: "시가→종가 · 나스닥 상승 뒤 코스피 상승",
          condition: "nasdaq_up",
          ratioPct: 46.56488549618321,
          count: 61,
          total: 131,
          baselinePct: 50.617283950617285,
          ciLowPct: 39.86001317523057,
          ciHighPct: 52.98507462686567,
        },
        {
          definition: "open_to_close",
          label: "시가→종가 · 나스닥 하락 뒤 코스피 하락",
          condition: "nasdaq_down",
          ratioPct: 43.75,
          count: 49,
          total: 112,
          baselinePct: 48.971193415637856,
          ciLowPct: 34.453548085901026,
          ciHighPct: 53.15610002525889,
        },
      ],
      note: "전날 나스닥 방향과 코스피의 관계는 시가 갭을 포함한 구간에서 더 크게 관찰됐으며, 시가 이후(모델 예측 구간) 방향과는 뚜렷한 관계가 관찰되지 않았습니다. 과거 통계이며 예측을 보장하지 않습니다.",
      source: "Yahoo Finance 일봉, 팀 재검증(2026-10-23)",
    },
  },
  composition: {
    basis: "equal_weight_reference",
    note: "TOP5 후보 종목군은 동일 비중으로 분산 투자하는 가상의 바스켓입니다.",
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
        { date: "2026-10-20", returnPct: 0.15 },
      ],
    },
    commonCautions: [
      "원/달러 환율 급변 시 대형 수출주 변동성 확대 주의",
      "개장 직후 특정 수급 쏠림 현상 관찰 필요",
    ],
  },
};

describe("KOSPI200_NIGHT & 7 Indicators Layout", () => {
  it("renders KOSPI200_NIGHT with open badge and closed badge", () => {
    const { rerender } = render(<BriefingMacroGrid macro={mockExtendedBriefingData.macro} />);

    // KOSPI200_NIGHT 카드 및 배지 확인
    expect(screen.getByTestId("macro-card-KOSPI200_NIGHT")).toBeInTheDocument();
    expect(screen.getByText("코스피200 야간선물")).toBeInTheDocument();
    expect(screen.getByText("야간 거래 중")).toBeInTheDocument();
    expect(screen.getByText("야간")).toBeInTheDocument();
    expect(screen.getByTestId("macro-value-KOSPI200_NIGHT")).toHaveTextContent("362.40pt");
    expect(screen.getByTestId("macro-change-KOSPI200_NIGHT")).toHaveTextContent("상승 1.15pt (+0.32%)");
    expect(screen.getByTestId("macro-change-KOSPI200_NIGHT")).not.toHaveTextContent("▲");

    // closed 상태 배지 확인
    const closedMacro: typeof mockExtendedBriefingData.macro = {
      ...mockExtendedBriefingData.macro,
      indicators: mockExtendedBriefingData.macro.indicators.map((ind) =>
        ind.id === "KOSPI200_NIGHT" ? { ...ind, session: "closed" } : ind
      ),
    };
    rerender(<BriefingMacroGrid macro={closedMacro} />);
    expect(screen.getByText("야간 종가")).toBeInTheDocument();
  });

  it("omits an unavailable night indicator while preserving other measured indicators", () => {
    const unavailableNightMacro: typeof mockExtendedBriefingData.macro = {
      ...mockExtendedBriefingData.macro,
      indicators: mockExtendedBriefingData.macro.indicators.map((ind) =>
        ind.id === "KOSPI200_NIGHT" ? { ...ind, status: "unavailable", value: null, change: null } : ind
      ),
    };
    render(<BriefingMacroGrid macro={unavailableNightMacro} />);
    expect(screen.queryByTestId("macro-card-KOSPI200_NIGHT")).not.toBeInTheDocument();
    expect(screen.getByTestId("macro-card-KOSPI")).toBeInTheDocument();
  });
});

describe("macro.reference (참고 통계) Component", () => {
  it("renders summary row, toggles inline SVG chart and asserts B2 4-row grouping and baselines", () => {
    const { container } = render(<BriefingMacroGrid macro={mockExtendedBriefingData.macro} />);

    // 카드 및 1줄 요약 노출 확인 (서버 note 그대로 노출)
    expect(screen.getByTestId("briefing-macro-reference-card")).toBeInTheDocument();
    const summary = screen.getByTestId("macro-reference-summary");
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain("전날 나스닥 방향과 코스피의 관계는 시가 갭을 포함한 구간에서");

    // 초기 상태: 차트 미노출
    expect(screen.queryByTestId("macro-reference-chart")).not.toBeInTheDocument();

    // 펼치기 버튼 클릭
    const toggleBtn = screen.getByTestId("macro-reference-toggle-btn");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggleBtn);

    // 펼쳐짐 확인
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("macro-reference-chart")).toBeInTheDocument();

    // B2 단언: 조건별 그룹 2개 및 4개 행 라벨 확인 (전일 종가→종가 및 시가→종가 x 상승/하락)
    expect(screen.getByText("나스닥 상승 뒤 코스피 상승 비율")).toBeInTheDocument();
    expect(screen.getByText("나스닥 하락 뒤 코스피 하락 비율")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /좌우 방향키로 스크롤/ })).toHaveAttribute("tabindex", "0");
    for (const row of mockExtendedBriefingData.macro.reference!.rows) {
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining(row.label));
    }
    expect(screen.getByText("조건부 비율 / 같은 기간 기준선")).toBeInTheDocument();

    // B2 단언: 4개 행 기준선 확인
    expect(screen.getByTestId("reference-baseline-close_to_close-nasdaq_up")).toBeInTheDocument();
    expect(screen.getByTestId("reference-baseline-open_to_close-nasdaq_up")).toBeInTheDocument();
    expect(screen.getByTestId("reference-baseline-close_to_close-nasdaq_down")).toBeInTheDocument();
    expect(screen.getByTestId("reference-baseline-open_to_close-nasdaq_down")).toBeInTheDocument();

    // 수치 단언 (실제 result.json 수치)
    expect(screen.getByText(/73\.3% \(96\/131건\) · 기준 60\.9%/)).toBeInTheDocument();
    expect(screen.getByText(/46\.6% \(61\/131건\) · 기준 50\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/53\.6% \(60\/112건\) · 기준 39\.1%/)).toBeInTheDocument();
    expect(screen.getByText(/43\.8% \(49\/112건\) · 기준 49\.0%/)).toBeInTheDocument();

    // 출처 단언
    expect(screen.getByText(/Yahoo Finance 일봉, 팀 재검증/)).toBeInTheDocument();

    // '확률' 단어가 쓰이지 않고 '비율'이 쓰였는지 엄격 검증
    const refCardText = screen.getByTestId("briefing-macro-reference-card").textContent ?? "";
    expect(refCardText).not.toContain("확률");
    expect(refCardText).toContain("비율");

    // 다시 클릭하여 접기
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("macro-reference-chart")).not.toBeInTheDocument();
  });

  it("formats conditional ratio with baseline when note is absent", () => {
    const macroWithoutNote = {
      ...mockExtendedBriefingData.macro,
      reference: {
        ...mockExtendedBriefingData.macro.reference!,
        note: "",
      },
    };
    render(<BriefingMacroGrid macro={macroWithoutNote} />);
    const summary = screen.getByTestId("macro-reference-summary");
    expect(summary.textContent).toContain("나스닥 상승 다음 날 코스피 상승 비율 — 종가 기준 73.3% (기준선 60.9%) · 시가→종가 46.6% (기준선 50.6%)");
  });

  it("handles null reference without throwing or rendering card", () => {
    const macroWithoutRef = {
      ...mockExtendedBriefingData.macro,
      reference: null,
    };
    render(<BriefingMacroGrid macro={macroWithoutRef} />);
    expect(screen.queryByTestId("briefing-macro-reference-card")).not.toBeInTheDocument();
  });
});

describe("briefing.composition (TOP5 후보 구성 카드)", () => {
  it("renders note, sectors codes/tags, performance, positiveDays, asOf, cautions and disclaimer while omitting benchmark", () => {
    const onSelectStock = vi.fn();

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={mockExtendedBriefingData}
          selectedCode="005930"
          onSelectStock={onSelectStock}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    // 1. 카드 및 note
    expect(screen.getByTestId("briefing-composition-card")).toBeInTheDocument();
    expect(screen.getByTestId("composition-note")).toHaveTextContent(
      "TOP5 후보 종목군은 동일 비중으로 분산 투자하는 가상의 바스켓입니다."
    );

    // 2. 업종별 구성 및 출처, 종목 태그 클릭
    expect(screen.getByText("업종별 구성")).toBeInTheDocument();
    expect(screen.getByText("출처: KRX")).toBeInTheDocument();
    expect(screen.getByTestId("sector-반도체")).toHaveTextContent("반도체");
    expect(screen.getByTestId("sector-반도체")).toHaveTextContent("2종목");

    const stockTag = screen.getByRole("button", { name: /삼성전자 \(005930\) 선택/ });
    fireEvent.click(stockTag);
    expect(onSelectStock).toHaveBeenCalledWith("005930");

    // 3. 동일 비중 실측 기록 (measuredDays > 0)
    expect(screen.getByText("동일 비중 실측 기록")).toBeInTheDocument();
    expect(screen.getByText("동일 비중 참고")).toBeInTheDocument();
    expect(screen.getByTestId("composition-performance")).toHaveTextContent("과거 기록은 미래 수익을 보장하지 않으며 표본이 작습니다");
    expect(screen.getByTestId("composition-perf-as-of")).toHaveTextContent("기준: 10/23 15:30 KST");
    expect(screen.getByText("측정 45일")).toBeInTheDocument();
    expect(screen.getByText(/동일 비중·시가→종가·공식 실측 기록/)).toBeInTheDocument();
    expect(screen.getByTestId("composition-avg-return")).toHaveTextContent("+1.25%");
    expect(screen.getByTestId("composition-positive-days")).toHaveTextContent("상승 마감 28/45일");

    // 벤치마크는 완전히 제거되었음을 검증
    expect(screen.queryByText(/벤치마크/)).not.toBeInTheDocument();

    // recent 일별 수익률
    expect(screen.getByText("2026-10-22")).toBeInTheDocument();
    expect(screen.getByText("+0.85%")).toBeInTheDocument();
    expect(screen.getByText("-0.32%")).toBeInTheDocument();

    // 성과 기록 링크
    const historyLink = screen.getByRole("link", { name: /성과 기록 자세히 보기/ });
    expect(historyLink).toHaveAttribute("href", "/history");

    // 4. 공통 주의사항
    expect(screen.getByText("원/달러 환율 급변 시 대형 수출주 변동성 확대 주의")).toBeInTheDocument();

    // 5. 면책 문구
    expect(screen.queryByTestId("composition-disclaimer")).not.toBeInTheDocument();
  });

  it("displays '—' when averageReturnPct is null and omits sectors when sectors is null", () => {
    const nullFieldsBriefing: BriefingPayload = {
      ...mockExtendedBriefingData,
      composition: {
        basis: "equal_weight_reference",
        note: "안내 문구",
        sectors: null, // sectors null
        sectorSource: null,
        performance: {
          asOf: null,
          measuredDays: 30,
          averageReturnPct: null, // null 유지
          positiveDays: 16,
          recent: [],
        },
        commonCautions: [],
      },
    };

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={nullFieldsBriefing}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    // 업종 영역 생략 확인
    expect(screen.queryByTestId("composition-sectors")).not.toBeInTheDocument();
    // 평균 수익률 "—" 표시 확인
    expect(screen.getByTestId("composition-avg-return")).toHaveTextContent("—");
    expect(screen.getByTestId("composition-positive-days")).toHaveTextContent("상승 마감 16/30일");
  });

  it("displays '아직 실측 기록이 없습니다' when measuredDays is 0 or performance is null", () => {
    const zeroPerfBriefing: BriefingPayload = {
      ...mockExtendedBriefingData,
      composition: {
        ...mockExtendedBriefingData.composition!,
        performance: {
          asOf: "2026-10-23T06:30:00Z",
          measuredDays: 0,
          averageReturnPct: null,
          positiveDays: 0,
          recent: [],
        },
      },
    };

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={zeroPerfBriefing}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("composition-no-perf")).toHaveTextContent("아직 실측 기록이 없습니다");
    expect(screen.queryByTestId("composition-perf-as-of")).not.toBeInTheDocument();
  });

  it("handles raw contract JSON directly adapted via adaptBriefing and renders accurately", () => {
    // 7. 계약 원문 JSON을 그대로 어댑터에 넣어 화면 값이 맞게 나오는 테스트
    const contractJson = {
      version: 1,
      status: "ready",
      macro: {
        asOf: "2026-10-23T06:30:00Z",
        indicators: [],
      },
      stocks: [
        {
          rank: 1,
          code: "005930",
          name: "삼성전자",
          rankScore: 2.1,
          poolSize: 200,
          topPercent: 0.5,
          evidence: [],
          cautions: [],
          news: { status: "not_collected", articles: [] },
        },
      ],
      narrative: {
        status: "template",
        generatedAt: "2026-10-23T06:30:00Z",
        llmModel: null,
        inputHash: "hash-c",
        fallbackReason: "not_generated",
        overview: "오버뷰",
        marketNote: "매크로",
        stocks: [],
        citations: [],
      },
      composition: {
        basis: "equal_weight_reference",
        note: "계약 원문 기반 바스켓",
        sectors: [{ name: "반도체", codes: ["005930"] }],
        sectorSource: "KRX 코스피 업종분류",
        performance: {
          asOf: "2026-10-23T06:00:00Z",
          measuredDays: 20,
          averageReturnPct: 0.94,
          positiveDays: 13,
          recent: [{ date: "2026-10-23", returnPct: 1.2 }],
        },
        commonCautions: ["계약 공통 주의사항"],
      },
      disclaimer: "면책",
      data_meta: { source: "live", asOf: "2026-10-23T06:30:00Z" },
    };

    // adaptBriefing 어댑터 호출
    const adapted = adaptBriefing(contractJson);

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={adapted}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("계약 원문 기반 바스켓")).toBeInTheDocument();
    expect(screen.getByText("출처: KRX 코스피 업종분류")).toBeInTheDocument();
    expect(screen.getByTestId("composition-avg-return")).toHaveTextContent("+0.94%");
    expect(screen.getByTestId("composition-positive-days")).toHaveTextContent("상승 마감 13/20일");
    expect(screen.getByText("계약 공통 주의사항")).toBeInTheDocument();
  });

  it("handles null composition gracefully", () => {
    const nullCompBriefing: BriefingPayload = {
      ...mockExtendedBriefingData,
      composition: null,
    };

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={nullCompBriefing}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("briefing-composition-card")).not.toBeInTheDocument();
  });
});

describe("Layout Hierarchy Order (화면 위계 순서 검증)", () => {
  it("renders in order: narrative card -> children (TOP5 table) -> stocks section -> macro grid -> composition card -> disclaimer", () => {
    const { container } = render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={mockExtendedBriefingData}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        >
          <div data-testid="mock-top5-table">TOP5 표</div>
        </BriefingTopContainer>
      </MemoryRouter>
    );

    const narrative = container.querySelector(".briefing-narrative-card")!;
    const macro = container.querySelector(".briefing-macro-section")!;
    const top5Table = container.querySelector("[data-testid='mock-top5-table']")!;
    const composition = container.querySelector(".briefing-composition-card")!;
    const stocks = container.querySelector(".briefing-stocks-section")!;
    const disclaimer = container.querySelector(".briefing-disclaimer")!;

    expect(narrative).not.toBeNull();
    expect(macro).not.toBeNull();
    expect(top5Table).not.toBeNull();
    expect(composition).not.toBeNull();
    expect(stocks).not.toBeNull();
    expect(disclaimer).not.toBeNull();

    // DOM document position 순서 검증 (A.compareDocumentPosition(B) & Node.DOCUMENT_POSITION_FOLLOWING)
    const isFollowing = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isFollowing(narrative, top5Table)).toBe(true);
    expect(isFollowing(top5Table, stocks)).toBe(true);
    expect(isFollowing(stocks, macro)).toBe(true);
    expect(isFollowing(macro, composition)).toBe(true);
    expect(isFollowing(composition, disclaimer)).toBe(true);
  });
});

describe("Extended Prohibited Terms Check with Composition & Reference", () => {
  it("allows '동일 비중' and '순매수' while prohibiting forbidden advisory terms across all components", () => {
    const { container } = render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={mockExtendedBriefingData}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    // 참고 통계도 펼쳐서 확인
    const toggleBtn = screen.getByTestId("macro-reference-toggle-btn");
    fireEvent.click(toggleBtn);

    // 종목 카드도 펼쳐서 내부 근거('순매수')까지 포함해 검증
    const stockExpandBtn = screen.getByTestId("stock-expand-btn-005930");
    fireEvent.click(stockExpandBtn);

    const fullText = container.textContent ?? "";

    // 허용된 단어들이 실제로 텍스트에 포함되어 있는지 확인
    expect(fullText).toContain("동일 비중");
    expect(fullText).toContain("순매수");

    // 금지 표현 정규식
    const PROHIBITED_PATTERN =
      /매수\s*권유|추천\b|목표가|상승\s*예상|확률|비중\s*확대|비중\s*축소|최적\s*비중|추천\s*비중|비중을\s*늘|비중을\s*줄/;

    const match = fullText.match(PROHIBITED_PATTERN);
    if (match) {
      throw new Error(
        `차단된 표현 '${match[0]}'이 발견되었습니다: ${fullText.slice(
          Math.max(0, match.index! - 20),
          match.index! + 30
        )}`
      );
    }
    expect(match).toBeNull();
  });
});

describe("Narrative fieldSources & partial_template (서버 계약 optional 추가분)", () => {
  it("renders partial_template badge and notice when fallbackReason is partial_template", () => {
    const partialNarrative: typeof mockBriefingData.narrative = {
      ...mockBriefingData.narrative,
      status: "llm",
      fallbackReason: "partial_template",
      fieldSources: {
        overview: "template",
        marketNote: "llm",
      },
      stocks: [
        {
          ...mockBriefingData.narrative.stocks[0],
          source: "template",
        },
        ...mockBriefingData.narrative.stocks.slice(1),
      ],
    };

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={{
            ...mockBriefingData,
            narrative: partialNarrative,
          }}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    // 1. partial_template 배지 확인
    expect(screen.getByTestId("narrative-badge-ai")).toHaveTextContent("AI 요약 · 일부 자동 생성 문장 포함");
    expect(screen.getByTestId("narrative-model")).toHaveTextContent("gemini-2.5-flash");

    // 2. 안내 문구 확인
    expect(screen.getByTestId("narrative-partial-template-notice")).toHaveTextContent(
      "AI 문장과 자동 생성 문장을 함께 표시합니다"
    );

    // 3. overview 필드 '규칙 기반' 태그 확인
    expect(screen.getByTestId("field-source-overview")).toHaveTextContent("자동 생성");
    // marketNote는 llm이므로 태그 없음
    expect(screen.queryByTestId("field-source-market-note")).not.toBeInTheDocument();

    // 4. 종목 요약 '규칙 기반' 태그 확인
    expect(screen.getByTestId("stock-source-005930")).toHaveTextContent("자동 생성");
    expect(screen.getByTestId("narrative-partial-template-notice")).not.toHaveClass("is-warning");
  });

  it("handles missing optional fieldSources and stock.source gracefully", () => {
    const defaultNarrative: typeof mockBriefingData.narrative = {
      ...mockBriefingData.narrative,
      status: "llm",
      fallbackReason: null,
      fieldSources: undefined,
      stocks: [
        {
          code: "005930",
          summary: "테스트 요약",
          citations: [],
          source: undefined,
        },
      ],
    };

    render(
      <MemoryRouter>
        <BriefingTopContainer
          briefing={{
            ...mockBriefingData,
            narrative: defaultNarrative,
          }}
          selectedCode="005930"
          onSelectStock={vi.fn()}
          isGenerating={false}
          generateError={null}
          onGenerateNarrative={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("narrative-badge-ai")).toHaveTextContent("AI 요약");
    expect(screen.queryByTestId("narrative-partial-template-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("field-source-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stock-source-005930")).not.toBeInTheDocument();
  });
});


// Presentation and navigation regressions from the final UI review.
describe("briefing review regressions", () => {
  it.each(["partial_template", "generation_timeout", "unknown_code"])("keeps machine identifiers out of all briefing text: %s", reason => {
    const data = structuredClone(mockExtendedBriefingData);
    data.narrative.fallbackReason = reason;
    data.narrative.status = reason === "partial_template" ? "llm" : "template";
    data.narrative.macroStale = false;
    data.narrative.generatedAt = new Date(Date.now() - 601_000).toISOString();
    const { container } = render(<MemoryRouter><BriefingTopContainer briefing={data} selectedCode={null} onSelectStock={vi.fn()} isGenerating={false} generateError={null} onGenerateNarrative={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("macro-reference-toggle-btn"));
    expectReadableUserText(container);
    expect(container.textContent).not.toMatch(/macroStale|fallbackReason|partial_template|generation_timeout/);
    if (reason === "partial_template") expect(screen.getByTestId("partial-template-policy-hint")).toHaveTextContent("시장 지표가 갱신되면 다시 생성할 수 있습니다");
  });
  it("deduplicates citations and hides rank references outside the displayed TOP5", () => {
    render(<BriefingNarrativeCard narrative={{ ...mockBriefingData.narrative, citations: ["R:005930", "R:005930", "R:999999", "M:KOSPI", "M:KOSPI"] }} stocks={mockBriefingData.stocks} isGenerating={false} generateError={null} onGenerate={vi.fn()} onCitationClick={vi.fn()} />);
    expect(screen.getAllByTestId("citation-chip-R:005930")).toHaveLength(1);
    expect(screen.getAllByTestId("citation-chip-M:KOSPI")).toHaveLength(1);
    expect(screen.queryByTestId("citation-chip-R:999999")).not.toBeInTheDocument();
    expect(screen.getByTestId("citation-chip-R:005930")).toHaveAttribute("aria-label", "삼성전자 종목 카드로 이동");
  });
  it("shows absent stock measurements as dashes and makes summary chips informational", () => {
    render(<MemoryRouter><BriefingStockSection stocks={[{ ...mockBriefingData.stocks[0], rankScore: null, poolSize: null, topPercent: null }]} narrative={mockBriefingData.narrative} selectedCode={null} onSelectStock={vi.fn()} /></MemoryRouter>);
    const card = screen.getByTestId("stock-card-005930");
    expect(card).toHaveTextContent("상위 — · 순위 점수: —");
    expect(card).not.toHaveTextContent("종목 중");
    const chip = screen.getByTestId("stock-chip-evidence-005930");
    fireEvent.click(chip);
    expect(screen.getByTestId("stock-expand-btn-005930")).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("stock-details-005930")).not.toBeNull();
  });
});

describe("narrative regeneration policy", () => {
  it("enforces ten minutes, updates at the boundary, and still requires changed market data", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T07:00:00Z"));
    try {
      const narrative = { ...mockBriefingData.narrative, generatedAt: "2026-10-23T06:55:00Z", macroStale: true };
      const props = { narrative, stocks: mockBriefingData.stocks, isGenerating: false, generateError: null, onGenerate: vi.fn(), onCitationClick: vi.fn() };
      const { rerender, unmount } = render(<BriefingNarrativeCard {...props} />);
      expect(screen.getByTestId("narrative-generate-btn")).toBeDisabled();
      expect(screen.getByText("최근 생성 후 10분이 지나면 최신 지표로 다시 생성할 수 있습니다")).toBeInTheDocument();
      expect(screen.getByTestId("narrative-status-notice")).toHaveClass("is-neutral");
      act(() => { vi.advanceTimersByTime(299_999); });
      expect(screen.getByTestId("narrative-generate-btn")).toBeDisabled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByTestId("narrative-generate-btn")).toBeEnabled();
      rerender(<BriefingNarrativeCard {...props} narrative={{ ...narrative, macroStale: false }} />);
      expect(screen.getByTestId("narrative-generate-btn")).toBeDisabled();
      unmount();
    } finally { vi.useRealTimers(); }
  });
  it("keeps first generation available for templates and waits for an already-running request", () => {
    const props = { narrative: { ...mockBriefingData.narrative, status: "template" as const, generatedAt: new Date().toISOString(), macroStale: false }, stocks: mockBriefingData.stocks, isGenerating: false, generateError: null, onGenerate: vi.fn(), onCitationClick: vi.fn() };
    const { rerender } = render(<BriefingNarrativeCard {...props} />);
    expect(screen.getByTestId("narrative-generate-btn")).toBeEnabled();
    rerender(<BriefingNarrativeCard {...props} narrative={{ ...props.narrative, fallbackReason: "generation_in_progress" }} />);
    expect(screen.getByTestId("narrative-generate-btn")).toBeDisabled();
    expect(screen.getByTestId("narrative-generate-btn")).toHaveAttribute("aria-busy", "true");
  });
  it("shows only the priority status and moves supporting information into disclosure", () => {
    render(<BriefingNarrativeCard narrative={{ ...mockBriefingData.narrative, fallbackReason: "partial_template", macroStale: true }} stocks={mockBriefingData.stocks} isGenerating={false} generateError={null} onGenerate={vi.fn()} onCitationClick={vi.fn()} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId("narrative-partial-template-notice")).toBeVisible();
    const supporting = screen.getByText("입력 자료만 요약하며 순위에 영향을 주지 않습니다");
    expect(supporting.closest("details")).not.toHaveAttribute("open");
  });
  it("uses the same two-decimal precision as model evidence without inventing a population", () => {
    const stock = { ...mockBriefingData.stocks[0], poolSize: 199, topPercent: 2 / 199 * 100 };
    const { rerender } = render(<MemoryRouter><BriefingStockSection stocks={[stock]} narrative={mockBriefingData.narrative} selectedCode={null} onSelectStock={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId("stock-card-005930")).toHaveTextContent("199종목 중 상위 1.01%");
    rerender(<MemoryRouter><BriefingStockSection stocks={[{ ...stock, poolSize: null }]} narrative={mockBriefingData.narrative} selectedCode={null} onSelectStock={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId("stock-card-005930")).not.toHaveTextContent("종목 중");
  });
  it("counts only articles retained by the adapter and removes repeated rank-score disclaimers", () => {
    const raw = structuredClone(mockBriefingData);
    raw.stocks[0].news.articles.push({ ...raw.stocks[0].news.articles[0], id: "N:005930:2", url: "" });
    raw.stocks[0].cautions.push({ id: "C:005930:2", kind: "model", text: "순위 점수는 수익률·확률이 아닙니다." });
    raw.narrative.stocks[0].summary = "상위 0.5%입니다. 순위 점수는 수익률·확률이 아닙니다.";
    const data = adaptBriefing(raw);
    render(<MemoryRouter><BriefingStockSection stocks={data.stocks} narrative={data.narrative} selectedCode={null} onSelectStock={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId("stock-chip-news-005930")).toHaveTextContent("기사 1건");
    fireEvent.click(screen.getByTestId("stock-expand-btn-005930"));
    expect(screen.getByTestId("stock-card-005930")).toHaveTextContent("1건 중 상위 1건");
    expect(screen.getByTestId("stock-card-005930")).not.toHaveTextContent("순위 점수는 수익률");
  });
});

beforeEach(() => window.sessionStorage.setItem("kospi-admin-token.v1", "fixture-admin"));
