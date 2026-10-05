import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { MarketDashboardData, StockQuote } from "../../types/trading";
import { readWatchlistCodes, writeWatchlistCodes } from "../../services/tradingData";
import type { CandidateAnalysisProgress, DashboardDataSource } from "../../services/tradingData";
import { AnalysisResults } from "./AnalysisResults";
import { MarketTopBar, marketNavItems } from "./MarketTopBar";

type AnalysisPhase = "idle" | "running" | "done";

export type DashboardSyncStatus = {
  dataSource: DashboardDataSource;
  errorMessage?: string;
  /** Index values were fetched live this session, even if stocks are a snapshot. */
  hasLiveIndices: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export type DashboardCandidateAnalysisStatus = {
  elapsedMs?: number;
  errorMessage?: string;
  isRunning: boolean;
  message?: string;
  onRun: () => void;
  progress?: CandidateAnalysisProgress;
};

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatRate(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const segments = points.slice(0, -1).map((point, index) => {
    const previous = points[index - 1] ?? point;
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const cp1x = point.x + (next.x - previous.x) / 6;
    const cp1y = point.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - point.x) / 6;
    const cp2y = next.y - (afterNext.y - point.y) / 6;

    return `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  });

  return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} ${segments.join(" ")}`;
}

type IndexSnapshot = MarketDashboardData["indices"][number];

/**
 * The index history series when it's on the same scale as the current value.
 * Otherwise (bundled sample shapes, failed history fetch) fall back to just
 * previous close → now, rather than drawing a fabricated intraday path.
 */
function resolveIndexSeries(index: IndexSnapshot): { fromHistory: boolean; values: number[] } {
  const series = index.miniSeries;
  const last = series[series.length - 1];
  const onScale =
    series.length > 1 &&
    last !== undefined &&
    index.value > 0 &&
    series.every((value) => Number.isFinite(value) && value > index.value * 0.5 && value < index.value * 1.5) &&
    Math.abs(last - index.value) / index.value <= 0.05;

  if (onScale) {
    return { fromHistory: true, values: series };
  }

  return { fromHistory: false, values: [index.value - index.change, index.value] };
}

function buildIndexChartGeometry(
  series: number[],
  direction: MarketDashboardData["indices"][number]["direction"],
  currentValue: number,
) {
  const source = series.length > 1 ? series : [series[0] ?? 0, series[0] ?? 0];
  const actualHigh = Math.max(...source);
  const actualLow = Math.min(...source);
  const midpoint = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : (actualHigh + actualLow) / 2;
  const visualRange = Math.max(actualHigh - actualLow, Math.abs(midpoint) * 0.012, 1);
  const high = midpoint + visualRange / 2;
  const low = midpoint - visualRange / 2;
  const range = high - low;
  const points = source.map((value, pointIndex) => {
    const x = 4 + (pointIndex / Math.max(source.length - 1, 1)) * 92;

    return {
      x,
      y: clamp(42 - ((value - midpoint) / range) * 40, 18, 66),
    };
  });
  const linePath = buildSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];

  return {
    areaPath: `${linePath} L ${last.x.toFixed(2)} 74 L ${first.x.toFixed(2)} 74 Z`,
    baselinePath: "M 4 42 H 96",
    first,
    last,
    linePath,
  };
}

type MarketRegimeView = {
  action: string;
  label: string;
  note: string;
  reasons: string[];
  score: number;
  tone: "down" | "neutral" | "up";
};

function percentChange(from: number, to: number) {
  if (!Number.isFinite(from) || Math.abs(from) < 0.000001) {
    return 0;
  }

  return ((to - from) / Math.abs(from)) * 100;
}

function normalizedSeriesSlope(series: number[]) {
  if (series.length < 2) {
    return 0;
  }

  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? first;
  const high = Math.max(...series);
  const low = Math.min(...series);
  const range = Math.max(high - low, Math.abs(first) * 0.01, 1);
  return clamp((last - first) / range, -1, 1);
}

function describeTrend(changeRate: number, slope: number) {
  const combined = changeRate * 0.22 + slope * 0.8;
  if (combined >= 0.7) {
    return "단기 추세 개선";
  }
  if (combined <= -0.7) {
    return "단기 추세 약화";
  }
  return "단기 추세 혼조";
}

function buildMarketRegime(index: IndexSnapshot): MarketRegimeView {
  const series = resolveIndexSeries(index).values;
  const slope = normalizedSeriesSlope(series);
  const previousValue = index.value - index.change;
  const valueChangeRate = percentChange(previousValue, index.value);
  const displayChangeRate = Number.isFinite(index.changeRate) && index.changeRate !== 0 ? index.changeRate : valueChangeRate;
  const rawScore = 50 + displayChangeRate * 4 + slope * 10;
  const score = Math.round(clamp(rawScore, 0, 100));
  const trendText = describeTrend(displayChangeRate, slope);
  const flowText = slope > 0.2 ? "최근 지수 흐름 상승세" : slope < -0.2 ? "최근 지수 흐름 하락세" : "최근 지수 흐름 혼조";

  if (score >= 62) {
    return {
      action: "선별 매수 환경",
      label: "상승 우위",
      note: "지수 흐름이 개선될 때는 AI 후보 중 수급과 뉴스가 함께 받쳐주는 종목을 우선 확인합니다.",
      reasons: [
        `${index.symbol} 전일 대비 ${formatRate(displayChangeRate)}`,
        flowText,
        trendText,
      ],
      score,
      tone: "up",
    };
  }

  if (score <= 42) {
    return {
      action: "관망 우위",
      label: "하락 압력",
      note: "지수가 약할 때는 개별 후보가 있더라도 진입 강도를 낮추고 근거가 강한 종목만 선별하는 접근이 유리합니다.",
      reasons: [
        `${index.symbol} 전일 대비 ${formatRate(displayChangeRate)}`,
        flowText,
        trendText,
      ],
      score,
      tone: "down",
    };
  }

  return {
    action: "보수적 선별",
    label: "중립 장세",
    note: "지수 방향성이 뚜렷하지 않을 때는 예측수익률보다 뉴스와 수급 근거의 일치 여부를 더 엄격하게 확인합니다.",
    reasons: [
      `${index.symbol} 전일 대비 ${formatRate(displayChangeRate)}`,
      flowText,
      trendText,
    ],
    score,
    tone: "neutral",
  };
}

function IndexCard({ index, isLive }: { index: IndexSnapshot; isLive: boolean }) {
  const series = useMemo(() => resolveIndexSeries(index), [index]);
  const chart = useMemo(
    () => buildIndexChartGeometry(series.values, index.direction, index.value),
    [index.direction, index.value, series.values],
  );
  const gradientKey = index.symbol.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const areaGradientId = `index-area-${gradientKey}`;
  const lineGradientId = `index-line-${gradientKey}`;
  const chartStartValue = series.values[0] ?? index.value - index.change;

  return (
    <article className={`index-card index-card--${index.direction}`}>
      <div className="index-card__title">
        <span>
          대표 지수
          <em>{isLive ? "KIS INDEX" : "샘플"}</em>
        </span>
        <strong>{index.value.toLocaleString("ko-KR")}</strong>
      </div>
      <div className="index-card__meta">
        <span className="index-card__name">
          <b>{index.name}</b>
          <small>전일 대비 추세</small>
        </span>
        <small className={`index-card__change market-change market-change--${index.direction}`}>
          {index.change.toLocaleString("ko-KR")} ({formatRate(index.changeRate)})
        </small>
      </div>
      <div className="index-card__chart-wrap">
        <svg className="index-card__chart" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={areaGradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="68%" stopColor="currentColor" stopOpacity="0.05" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={lineGradientId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.72" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path className="index-card__gridline" d="M 4 20 H 96 M 4 44 H 96 M 4 68 H 96" />
          <path className="index-card__baseline" d={chart.baselinePath} />
          <path className="index-card__area" d={chart.areaPath} fill={`url(#${areaGradientId})`} />
          <path className="index-card__line" d={chart.linePath} stroke={`url(#${lineGradientId})`} />
        </svg>
        <div className="index-card__chart-labels" aria-hidden="true">
          <span>
            {series.fromHistory ? "시작" : "전일 종가"} {chartStartValue.toLocaleString("ko-KR")}
          </span>
          <span>현재 {index.value.toLocaleString("ko-KR")}</span>
        </div>
      </div>
      <p className="index-card__caption">
        {isLive ? "KIS 현재값" : "샘플 지수"} · {series.fromHistory ? "최근 일봉 흐름" : "전일 종가 대비 (일봉 시계열 없음)"}
      </p>
    </article>
  );
}

function MarketRegimeCard({ index, isLive }: { index: IndexSnapshot; isLive: boolean }) {
  const regime = buildMarketRegime(index);

  return (
    <section className={`regime-card regime-card--${regime.tone}`} aria-label="KOSPI 시장 국면">
      <div className="regime-card__head">
        <div>
          <span>KOSPI 시장 국면</span>
          <strong>{regime.label}</strong>
        </div>
        <em>{isLive ? "KIS INDEX" : "샘플"}</em>
      </div>

      <div className="regime-card__action">
        <span>{regime.action}</span>
        <b>{regime.score}점</b>
      </div>

      <div className="regime-card__meter" aria-hidden="true">
        <i style={{ width: `${regime.score}%` }} />
      </div>

      <ul className="regime-card__reasons">
        {regime.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <p>{regime.note}</p>
    </section>
  );
}

function MarketOverview({
  analysisPhase,
  candidateAnalysis,
  data,
  syncStatus,
}: {
  analysisPhase: AnalysisPhase;
  candidateAnalysis: DashboardCandidateAnalysisStatus;
  data: MarketDashboardData;
  syncStatus: DashboardSyncStatus;
}) {
  const featuredIndices = data.indices.filter((index) => index.symbol === "KOSPI200");
  const indices = featuredIndices.length > 0 ? featuredIndices : data.indices.slice(0, 1);
  const isLive = syncStatus.dataSource === "live";
  const indicesLive = isLive || syncStatus.hasLiveIndices;
  const syncLabel = syncStatus.isRefreshing
    ? "KIS 동기화 중"
    : isLive
      ? "KIS 실시간 시세"
      : syncStatus.dataSource === "cache"
        ? "이 기기의 최근 동기화 시세"
        : "샘플 데이터";
  const scopeNote = isLive
    ? "종목·지수 KIS 시세"
    : indicesLive
      ? "지수만 KIS 실시간, 종목 시세는 새로고침 필요"
      : "새로고침하면 KIS 시세를 불러옵니다";

  return (
    <section className="market-overview" id="market-home" aria-labelledby="market-title">
      <div className="session-bar">
        <div className="session-bar__title">
          <h1 id="market-title">AI 후보 대시보드</h1>
          <p className="session-meta">
            <span className={`session-dot ${isLive ? "" : "session-dot--stale"}`} aria-hidden="true" />
            <span>{data.sessionLabel}</span>
            <span className="session-muted">{scopeNote}</span>
          </p>
        </div>
        <div className="session-bar__actions">
          <span
            className={`session-sync ${!isLive && !syncStatus.isRefreshing ? "session-sync--warning" : ""}`}
            role="status"
            aria-live="polite"
          >
            {syncStatus.isRefreshing ? <i aria-hidden="true" /> : null}
            {syncLabel}
          </span>
          <button className="session-refresh" disabled={syncStatus.isRefreshing} onClick={syncStatus.onRefresh} type="button">
            새로고침
          </button>
          {/* Before the first run the analysis gate below owns the single primary
              CTA; afterwards a secondary re-run lives here. */}
          {analysisPhase === "done" ? (
            <button
              className="candidate-analysis-button"
              disabled={candidateAnalysis.isRunning}
              onClick={candidateAnalysis.onRun}
              type="button"
            >
              다시 분석
            </button>
          ) : null}
        </div>
        {/* Always mounted so screen readers announce the completion message
            when it appears (a freshly inserted live region is often missed). */}
        <p className="candidate-analysis-status" role="status">
          {analysisPhase !== "running" ? candidateAnalysis.message : null}
        </p>
        {candidateAnalysis.errorMessage ? (
          <p className="candidate-analysis-status candidate-analysis-status--error" role="alert">
            AI 후보 분석 실패: {candidateAnalysis.errorMessage}
          </p>
        ) : null}
        {syncStatus.errorMessage ? (
          <p className="session-error" title={syncStatus.errorMessage}>
            실시간 시세를 불러오지 못해 {syncStatus.dataSource === "sample" ? "샘플" : "이 기기의 최근 동기화"} 데이터를 표시합니다.
          </p>
        ) : null}
      </div>

      <div className="overview-grid">
        <MarketRegimeCard index={indices[0]} isLive={indicesLive} />
        {indices.map((index) => (
          <IndexCard index={index} isLive={indicesLive} key={index.symbol} />
        ))}
      </div>
    </section>
  );
}

/** How candidates are picked — reference material, collapsed by default. */
function SelectionMethod() {
  return (
    <details className="ai-brief">
      <summary>
        <span className="ai-brief__title">AI 후보 선정 방식</span>
        <span className="ai-brief__hint">모델 · 데이터 · 검증 기준</span>
      </summary>
      <div className="brief-intro">
        <p>
          <strong>Huber 앙상블</strong>이 KOSPI200 전체 종목의 다음 거래일 시가→종가 수익률을 예측해 순위를 매기고,
          상위 종목을 1차 후보로 고릅니다. 순위는 상대 비교이며 상승 확률이 아닙니다.
        </p>
        <p>
          뉴스 본문에서 추출한 사건을 근거로 함께 보여 줍니다. 뉴스 보정은 별도 검증 기준을 통과한 경우에만 최종 순위에
          반영합니다.
        </p>
      </div>
      <ol className="brief-flow" aria-label="AI 후보 선정 순서">
        <li>
          <span>분석 대상</span>
          <strong>KOSPI200 전체 종목</strong>
        </li>
        <li>
          <span>1차 모델</span>
          <strong>앙상블 시가→종가 수익률 예측</strong>
        </li>
        <li>
          <span>보조 데이터</span>
          <strong>거래량 변화 + 외국인·기관 수급</strong>
        </li>
        <li>
          <span>2차 판단</span>
          <strong>기사 사건·근거 추출</strong>
        </li>
        <li>
          <span>최종 후보</span>
          <strong>Top 5 종목</strong>
        </li>
      </ol>
    </details>
  );
}

function WatchlistRail({
  isOpen,
  isSelectedInWatchlist,
  onRemoveStock,
  onSelectStock,
  onToggleSelected,
  onToggleOpen,
  selectedStock,
  stocks,
}: {
  isOpen: boolean;
  isSelectedInWatchlist: boolean;
  onRemoveStock: (code: string) => void;
  onSelectStock: (stock: StockQuote) => void;
  onToggleSelected: () => void;
  onToggleOpen: () => void;
  selectedStock: StockQuote;
  stocks: StockQuote[];
}) {
  return (
    <aside className={`watch-rail ${isOpen ? "" : "watch-rail--collapsed"}`} aria-label="관심 종목">
      <div className="watch-rail__head">
        <strong>관심</strong>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={isOpen ? "관심 패널 닫기" : "관심 패널 열기"}
          onClick={onToggleOpen}
        >
          {isOpen ? <PanelRightClose aria-hidden="true" size={20} /> : <PanelRightOpen aria-hidden="true" size={20} />}
        </button>
      </div>
      <p className="watch-ai">
        선택 종목: <strong>{selectedStock.name}</strong>. 버튼으로 관심 목록을 직접 관리할 수 있습니다.
      </p>
      <button className="watch-selected-toggle" onClick={onToggleSelected} type="button">
        {isSelectedInWatchlist ? "선택 종목 관심 해제" : "선택 종목 관심 추가"}
      </button>
      {stocks.length > 0 ? (
        <ul>
          {stocks.map((stock) => (
            <li className={selectedStock.code === stock.code ? "is-selected" : undefined} key={stock.code}>
              <button className="watch-stock-button" onClick={() => onSelectStock(stock)} type="button">
                <span className="stock-logo" aria-hidden="true">
                  {stock.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{stock.name}</strong>
                  <small className={`market-change market-change--${stock.direction}`}>
                    {formatWon(stock.currentPrice)} · {formatRate(stock.changeRate)}
                  </small>
                </div>
              </button>
              <button className="watch-remove" onClick={() => onRemoveStock(stock.code)} type="button" aria-label={`${stock.name} 관심 해제`}>
                <X aria-hidden="true" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="watch-empty">
          <strong>관심 종목이 없습니다.</strong>
          <p>테이블이나 검색에서 종목을 선택한 뒤 추가해보세요.</p>
        </div>
      )}
    </aside>
  );
}

const analysisStages = [
  "실행 준비",
  "KOSPI200 후보 풀 로드",
  "OHLCV 수집·Huber 앙상블 예측",
  "외국인·기관 수급 조회",
  "뉴스 크롤링",
  "뉴스 사건 추출·검증 게이트",
  "결과 파일 검증",
];

/**
 * Gates the stock list behind the AI analysis action. Before analysis it shows a
 * clear call to action; while running it shows only the progress the server has
 * actually reported; once done the caller swaps in the real results.
 */
function AnalysisGate({
  elapsedMs,
  isRunning,
  onRun,
  phase,
  progress,
}: {
  elapsedMs?: number;
  isRunning: boolean;
  onRun: () => void;
  phase: "idle" | "running" | "done";
  progress?: CandidateAnalysisProgress;
}) {
  if (phase === "running") {
    // Without a server progress report we don't know the stage, so show an
    // indeterminate bar instead of inventing a percentage.
    const progressPercent = progress ? clamp(Math.round(progress.progressPercent), 0, 100) : undefined;
    const activeStage = progress?.stageIndex;
    const elapsedText = elapsedMs !== undefined ? ` · ${Math.floor(elapsedMs / 60000)}분 ${String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0")}초 경과` : "";

    return (
      <section className="analysis-gate analysis-gate--running" aria-busy="true">
        <div className="gate-scan" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2 className="gate-title">AI가 후보 종목을 분석하고 있습니다</h2>
        {/* Persistent live region: only the stage message is announced; the
            elapsed time ticks every poll and stays outside it. */}
        <p className="gate-stage">
          <span role="status">{progress?.message ?? "진행 단계 정보를 기다리는 중입니다"}</span>
          <span className="gate-elapsed">{elapsedText}</span>
        </p>
        {progressPercent !== undefined ? (
          <div
            className="gate-progress"
            role="progressbar"
            aria-label="분석 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <i style={{ width: `${progressPercent}%` }} />
            <span>{progressPercent}%</span>
          </div>
        ) : (
          <div className="gate-progress gate-progress--indeterminate" role="progressbar" aria-label="분석 진행 중, 진행률 미확인">
            <i />
          </div>
        )}
        <ol className="gate-steps" aria-label="분석 단계">
          {analysisStages.map((label, index) => {
            const state =
              activeStage === undefined
                ? "is-pending"
                : index < activeStage
                  ? "is-done"
                  : index === activeStage
                    ? "is-active"
                    : "is-pending";
            return (
              <li key={label} className={state} aria-current={state === "is-active" ? "step" : undefined}>
                <span aria-hidden="true" />
                {label}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <section className="analysis-gate analysis-gate--idle">
      <div className="gate-illus" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <h2>AI 분석을 진행하세요</h2>
      <p>
        아직 분석 전입니다. 아래 버튼을 누르면 코스피200 종목을 스캔해 단기 매수 후보를 근거와 함께
        골라냅니다.
      </p>
      <button className="gate-cta" type="button" onClick={onRun} disabled={isRunning}>
        <span className="gate-cta__dot" aria-hidden="true" />
        AI 분석 시작
      </button>
    </section>
  );
}

export function MarketWorkspace({
  analysisPhase,
  candidateAnalysis,
  data,
  syncStatus,
}: {
  analysisPhase: AnalysisPhase;
  candidateAnalysis: DashboardCandidateAnalysisStatus;
  data: MarketDashboardData;
  syncStatus: DashboardSyncStatus;
}) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("market-home");
  const [isWatchRailOpen, setWatchRailOpen] = useState(true);
  const [selectedCode, setSelectedCode] = useState(data.focusedStockCode);
  // The persisted watchlist survives reloads; the server's default list only
  // seeds first-time visitors (or storage-unavailable sessions).
  const [watchCodes, setWatchCodes] = useState<string[]>(
    () => readWatchlistCodes() ?? data.watchlist.map((stock) => stock.code),
  );

  useEffect(() => {
    writeWatchlistCodes(watchCodes);
  }, [watchCodes]);

  const selectedStock = data.stocks.find((stock) => stock.code === selectedCode) ?? data.stocks[0] ?? data.watchlist[0];
  const watchlist = useMemo(
    () =>
      watchCodes
        .map((code) => data.stocks.find((stock) => stock.code === code))
        .filter((stock): stock is StockQuote => Boolean(stock)),
    [data.stocks, watchCodes],
  );

  const isSelectedInWatchlist = watchCodes.includes(selectedStock.code);

  function navigateTo(sectionId: string) {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Honor a deep-link hash (e.g. /dashboard#market-table from the footer) once on
  // mount, after the workspace and its section anchors have rendered.
  useEffect(() => {
    const sectionId = window.location.hash.replace(/^#/, "");
    if (!sectionId || !marketNavItems.some((item) => item.id === sectionId)) {
      return;
    }

    setActiveSection(sectionId);
    // rAF: wait for layout so scrollIntoView targets the settled position.
    const raf = requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "auto", block: "start" });
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  // Clicking any stock (results, watchlist) navigates to its dedicated analysis
  // page (/stock/:code). We still track the selected code so the watchlist
  // highlight stays in sync.
  function selectStock(stock: StockQuote) {
    setSelectedCode(stock.code);
    navigate(`/stock/${stock.code}`);
  }

  function toggleSelectedWatchlist() {
    setWatchCodes((current) => {
      if (current.includes(selectedStock.code)) {
        return current.filter((code) => code !== selectedStock.code);
      }

      return [selectedStock.code, ...current];
    });
  }

  function removeWatchStock(code: string) {
    setWatchCodes((current) => current.filter((item) => item !== code));
  }

  return (
    <div className="market-workspace">
      <MarketTopBar activeSection={activeSection} onNavigate={navigateTo} stocks={data.stocks} />
      <main className={`market-shell ${isWatchRailOpen ? "" : "market-shell--watch-collapsed"}`} id="main-content" tabIndex={-1}>
        <div className="market-main">
          <MarketOverview
            analysisPhase={analysisPhase}
            candidateAnalysis={candidateAnalysis}
            data={data}
            syncStatus={syncStatus}
          />
          {/* Stable anchor for the "AI 후보" tab and /dashboard#market-table deep
              links: it exists both before analysis (gate) and after (results). */}
          <div id="market-table">
            {analysisPhase === "done" ? (
              <div className="market-content-grid">
                <AnalysisResults stocks={data.stocks} onSelect={(stock) => selectStock(stock)} />
              </div>
            ) : (
              <AnalysisGate
                elapsedMs={candidateAnalysis.elapsedMs}
                phase={analysisPhase}
                isRunning={candidateAnalysis.isRunning}
                onRun={candidateAnalysis.onRun}
                progress={candidateAnalysis.progress}
              />
            )}
          </div>
          <SelectionMethod />
        </div>
        <WatchlistRail
          isOpen={isWatchRailOpen}
          isSelectedInWatchlist={isSelectedInWatchlist}
          onRemoveStock={removeWatchStock}
          onSelectStock={(stock) => selectStock(stock)}
          onToggleOpen={() => setWatchRailOpen((value) => !value)}
          onToggleSelected={toggleSelectedWatchlist}
          selectedStock={selectedStock}
          stocks={watchlist}
        />
      </main>
    </div>
  );
}
