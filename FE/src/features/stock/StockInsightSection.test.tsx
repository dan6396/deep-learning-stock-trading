import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollapsibleNote, StockInsightSection } from "./StockInsightSection";
import { modelEvidence } from "../../entities/modelEvidence";
import { expectReadableUserText } from "../../test/assertUserText";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach(client => client.clear()));

describe("transparent input observations", () => {
  it("preserves the sample limit and uses nonzero-tail formatting throughout the report", () => {
    const client = new QueryClient(); clients.push(client);
    client.setQueryData(["stock-insight", "005930"], {
      model: modelEvidence({ prediction_status: "ok", score_kind: "rank_zscore", pred_rank: 1, pred_pool_size: 10000, rank_score: 1.6,
        rank_lb20: 1, rank_lb120: 2, score_lb20: 1.5, score_lb120: 1.7, feat_pct_f_rsi: 0.01 }),
      sensitivity: { status: "preparing", metrics: [], note: "", conditional: null },
      news: { summary: "", articles: [], limitation: "" },
      cautions: ["최근 1년 표본에 한정된 관측이며 미래 결과를 보장하지 않습니다."],
    });
    const { container } = render(<QueryClientProvider client={client}><StockInsightSection code="005930" /></QueryClientProvider>);
    expect(screen.getByText("최근 1년 표본에 한정된 관측입니다.")).toBeVisible();
    expect(screen.getByRole("img", { name: "20일 모델 1위, 상위 0.1% 미만" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "120일 모델 2위, 상위 0.1% 미만" })).toBeInTheDocument();
    expect(screen.getByText("하위 0.1% 미만")).toBeVisible();
    expect(container).not.toHaveTextContent(/(?:상위|하위) 0%/);
  });

  it("shows factual comparison, feature positions and sample-qualified statistics without internal identifiers", () => {
    const client = new QueryClient(); clients.push(client);
    client.setQueryData(["stock-insight", "005930"], { model: modelEvidence({ prediction_status: "ok", score_kind: "rank_zscore", pred_rank: 1, pred_pool_size: 199, rank_score: 1.6015,
      rank_lb20: 2, rank_lb120: 3, score_lb20: 1.5, score_lb120: 1.7, model_agreement: "일치", feat_pct_f_close: 95 }),
      sensitivity: { status: "ready", samples: 240, periodStart: "2025-10-23", periodEnd: "2026-10-22", metrics: [{ definition: "close_to_close", correlation: .3, beta: .8, samples: 240 }, { definition: "open_to_close", correlation: .02, beta: .1, samples: 240 }], conditional: { ratioPct: 51, count: 51, total: 100, baselinePct: 50, baselineCount: 120, baselineTotal: 240 }, source: "KIS 종목 일봉 · Yahoo Finance 나스닥 일봉", note: "과거 관측입니다." },
      news: { summary: "공시 제목을 확인했습니다.", articles: [{ id: "N:005930:1", source: "발행처", title: "공시", url: "https://example.com", pubDate: null }], limitation: "기사 본문을 수집하지 않았습니다." }, cautions: ["하루 등락만으로 모델을 평가하지 않습니다."] });
    const { container } = render(<QueryClientProvider client={client}><StockInsightSection code="005930" /></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "모델 순위와 주요 지표" })).toHaveAttribute("id", "stock-input-observations-heading");
    expect(screen.getByRole("region", { name: "모델 순위와 주요 지표" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "20일 모델 2위, 상위 1%" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "120일 모델 3위, 상위 1.5%" })).toBeInTheDocument();
    expect(screen.getByTitle("모델 일치도")).toHaveTextContent("일치");
    expect(screen.getByText("상위 1%").closest("div")).toHaveTextContent("20일 모델2위");
    expect(screen.getByRole("meter")).toHaveAttribute("value", "95");
    expect(screen.queryByText("공시 제목을 확인했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "뉴스 이슈와 출처" })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("종가→종가"); expect(screen.getByText(/51\/100일/)).toBeInTheDocument();
    expect(container).toHaveTextContent("1.60");
    expect(container).toHaveTextContent("모델 기여도"); expectReadableUserText(container);
  });

  it("shows toggle only when content actually overflows (scrollHeight > clientHeight), toggles expansion and resets on text change", () => {
    const origScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

    try {
      // 1. 넘칠 때 (scrollHeight: 120 > clientHeight: 60)
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 120 });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 60 });

      const longNoteWithDecimal = "최근 1년 동안 나스닥 상승 시 동반 상승 비율은 평균 51.2%보다 높게 나타났으며, 통계적으로 유의미한 변동 패턴을 분석하여 모델 입력 특징으로 반영했습니다.";
      const { rerender } = render(<CollapsibleNote className="stock-ai-summary" text={longNoteWithDecimal} />);

      const noteEl = screen.getByText(longNoteWithDecimal);
      expect(noteEl).toBeInTheDocument();
      expect(noteEl).toHaveClass("insight-note-clamped");
      expect(noteEl.parentElement).toHaveClass("stock-ai-summary");

      const toggleBtn = screen.getByRole("button", { name: "자세히" });
      expect(toggleBtn).toBeInTheDocument();
      expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
      expect(toggleBtn).toHaveAttribute("aria-controls", noteEl.id);

      // 자세히 클릭 -> 펼침 (말줄임 클래스 제거, 버튼은 접기로 변경)
      fireEvent.click(toggleBtn);
      expect(screen.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(longNoteWithDecimal)).not.toHaveClass("insight-note-clamped");

      // text 변경 시 expanded 상태 리셋
      const updatedNote = "다른 긴 설명 텍스트입니다. 변동성 요인이 추가되어 관측치가 갱신되었습니다.";
      rerender(<CollapsibleNote className="stock-ai-summary" text={updatedNote} />);
      const updatedToggleBtn = screen.getByRole("button", { name: "자세히" });
      expect(updatedToggleBtn).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText(updatedNote)).toHaveClass("insight-note-clamped");

      // 다시 펼쳤다가 접기 클릭
      fireEvent.click(updatedToggleBtn);
      expect(screen.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(screen.getByRole("button", { name: "접기" }));
      expect(screen.getByRole("button", { name: "자세히" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText(updatedNote)).toHaveClass("insight-note-clamped");
    } finally {
      if (origScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", origScrollHeight);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });

  it("does not show toggle button even for long text when content does not overflow (scrollHeight === clientHeight)", () => {
    const origScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

    try {
      // 넘치지 않을 때 (scrollHeight: 60 === clientHeight: 60)
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 60 });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 60 });

      const longNote = "긴 설명 텍스트이지만 컨테이너 높이가 충분하여 말줄임 한도를 넘지 않는 경우입니다. " + "추가 내용이 있어도 스크롤 높이와 클라이언트 높이가 같아 오버플로우가 없습니다.".repeat(2);
      render(<CollapsibleNote text={longNote} />);

      const noteEl = screen.getByText(longNote);
      expect(noteEl).toBeInTheDocument();
      // 항상 기본으로 clamped 클래스는 붙어있으나
      expect(noteEl).toHaveClass("insight-note-clamped");
      // 오버플로우하지 않으므로 토글 버튼은 노출되지 않아야 함
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    } finally {
      if (origScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", origScrollHeight);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
