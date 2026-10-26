import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StockInsightSection } from "./StockInsightSection";
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
    expect(screen.getByRole("table")).toHaveTextContent("종가→종가"); expect(screen.getByText(/51\/100일/)).toBeInTheDocument();
    expect(container).toHaveTextContent("모델 기여도"); expect(container).toHaveTextContent("기사 본문을 수집하지 않았습니다"); expectReadableUserText(container);
  });
});
