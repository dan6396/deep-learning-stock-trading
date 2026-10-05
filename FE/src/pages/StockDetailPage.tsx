import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MarketTopBar } from "../components/market/MarketTopBar";
import { StockChartPanel } from "../components/market/stock-chart";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  fetchStockAnalysis,
  fetchStockQuoteData,
  getMarketDashboardData,
  readWatchlistCodes,
  writeWatchlistCodes,
} from "../services/tradingData";
import { getAiCandidate } from "../data/aiCandidates";
import type { AiCandidate, AiNews } from "../data/aiCandidates";
import { rowToCandidate } from "../data/pipelineAdapter";
import type { MarketDirection, StockQuote } from "../types/trading";

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatRate(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Net-buy won amounts come in raw KRW; show them in 억원 for readability. */
function formatEok(won: number) {
  const abs = Math.abs(won / 100_000_000);
  const value =
    abs >= 10 ? Math.round(abs).toLocaleString("ko-KR") : abs >= 1 ? abs.toFixed(1) : abs > 0 ? abs.toFixed(2) : "0";
  return `${won > 0 ? "+" : won < 0 ? "-" : ""}${value}억원`;
}

function directionLabel(direction: MarketDirection) {
  return direction === "up" ? "상승" : direction === "down" ? "하락" : "보합";
}

function changeTone(value: number) {
  return value > 0 ? "is-positive-text" : value < 0 ? "is-negative-text" : undefined;
}

/** Brand-consistent tone for a sentiment label (KR market: 상승 red / 하락 blue). */
function sentimentTone(label: string) {
  const upper = label.toUpperCase();
  if (upper === "POSITIVE" || upper === "BULLISH") return "up";
  if (upper === "NEGATIVE" || upper === "BEARISH") return "down";
  return "neutral";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function parseSentimentTally(tally: string) {
  const result = { negative: 0, neutral: 0, positive: 0 };
  const matches = tally.matchAll(/(긍정|부정|중립|혼합)\s*(\d+)\s*건/g);
  for (const match of matches) {
    const count = Number(match[2]);
    if (match[1] === "긍정") result.positive = count;
    if (match[1] === "부정") result.negative = count;
    if (match[1] === "중립" || match[1] === "혼합") result.neutral += count;
  }
  return result;
}

function formatRatio(count: number, total: number) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

type NewsTone = "negative" | "neutral" | "positive";

type ClassifiedNews = AiNews & {
  tone: NewsTone;
  toneLabel: string;
  toneReason?: string;
  /** "keyword" = no LLM label; tone guessed from title/summary keywords. */
  toneSource: "llm" | "keyword";
};

const NEWS_TONE_META: Record<NewsTone, { label: string; shortLabel: string }> = {
  positive: { label: "긍정 뉴스", shortLabel: "긍정" },
  neutral: { label: "중립 뉴스", shortLabel: "중립" },
  negative: { label: "부정 뉴스", shortLabel: "부정" },
};

const POSITIVE_NEWS_KEYWORDS = [
  "상승",
  "오른",
  "급등",
  "강세",
  "호재",
  "매수",
  "추천",
  "목표가",
  "상향",
  "성장",
  "수주",
  "흑자",
  "개선",
  "최대",
  "돌파",
  "호실적",
  "기대",
  "수혜",
  "확대",
  "친환경",
  "슈퍼사이클",
  "유망",
  "buy",
];

const NEGATIVE_NEWS_KEYWORDS = [
  "하락",
  "급락",
  "약세",
  "악재",
  "담합",
  "구속",
  "수사",
  "적자",
  "부진",
  "하회",
  "리스크",
  "매도",
  "하향",
  "감소",
  "침체",
  "우려",
  "조정",
  "손실",
  "중단",
  "불확실",
  "과열",
  "부담",
];

function newsToneFromSentiment(label: string | undefined): NewsTone | null {
  const normalized = String(label ?? "").toUpperCase();
  if (normalized === "POSITIVE" || normalized === "BULLISH" || normalized.includes("긍정")) return "positive";
  if (normalized === "NEGATIVE" || normalized === "BEARISH" || normalized.includes("부정")) return "negative";
  if (normalized === "NEUTRAL" || normalized.includes("중립")) return "neutral";
  return null;
}

function keywordScore(text: string, keywords: string[]) {
  const lowered = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lowered.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function classifyNews(item: AiNews): ClassifiedNews {
  const llmTone = newsToneFromSentiment(item.sentiment ?? item.sentimentKo);
  if (llmTone) {
    return {
      ...item,
      tone: llmTone,
      toneLabel: NEWS_TONE_META[llmTone].shortLabel,
      toneReason: item.sentimentReason,
      toneSource: "llm",
    };
  }

  const text = `${item.title} ${item.description}`;
  const positiveScore = keywordScore(text, POSITIVE_NEWS_KEYWORDS);
  const negativeScore = keywordScore(text, NEGATIVE_NEWS_KEYWORDS);
  const tone: NewsTone =
    positiveScore > negativeScore ? "positive" : negativeScore > positiveScore ? "negative" : "neutral";

  return {
    ...item,
    tone,
    toneLabel: NEWS_TONE_META[tone].shortLabel,
    toneSource: "keyword",
  };
}

function groupedNews(news: AiNews[]) {
  const classified = news.map(classifyNews);
  const groups = (["positive", "neutral", "negative"] as const)
    .map((tone) => ({
      tone,
      ...NEWS_TONE_META[tone],
      items: classified.filter((item) => item.tone === tone),
    }))
    .filter((group) => group.items.length > 0);
  return { groups, items: classified, keywordCount: classified.filter((item) => item.toneSource === "keyword").length };
}

/** News adjustment arrives as a fraction (0.003 = 0.30%p). */
function formatAdjustmentPp(value: number | null | undefined) {
  return `${((value ?? 0) * 100).toFixed(2)}%p`;
}

/**
 * The headline signal: where the stock ranks among the pool on predicted
 * next-day return. A rank is a relative comparison, so it is shown as one
 * instead of a gauge that reads like a probability.
 */
function RankSummary({ candidate }: { candidate: AiCandidate }) {
  const hasRank = candidate.rank > 0 && candidate.poolSize > 1;
  const topPercent = hasRank ? Math.max(1, Math.round((candidate.rank / candidate.poolSize) * 100)) : null;

  return (
    <div className="rank-summary">
      {hasRank ? (
        <>
          <span className="rank-summary__label">예측수익률 순위</span>
          <strong className="rank-summary__value">
            {candidate.rank}
            <small>위</small>
          </strong>
          <span className="rank-summary__sub">
            {candidate.poolSize}종목 중 · 상위 {topPercent}%
          </span>
        </>
      ) : (
        <>
          <span className="rank-summary__label">결합 점수</span>
          <strong className="rank-summary__value">
            {Math.round(candidate.finalCombinedScore)}
            <small>/100</small>
          </strong>
          <span className="rank-summary__sub">모델·뉴스·수급 합산 · 확률 아님</span>
        </>
      )}
    </div>
  );
}

/**
 * Donut counts, most authoritative source first: per-article LLM labels, then
 * the pipeline's LLM tally, and only then the keyword guesses. The caption
 * names the basis so it never silently disagrees with other numbers.
 */
function newsToneCounts(candidate: AiCandidate) {
  const classified = candidate.news.map(classifyNews);
  const fromArticles = (basis: string) => {
    const count = (tone: NewsTone) => classified.filter((item) => item.tone === tone).length;
    return {
      positive: count("positive"),
      neutral: count("neutral"),
      negative: count("negative"),
      total: classified.length,
      basis,
    };
  };

  if (classified.length > 0 && classified.every((item) => item.toneSource === "llm")) {
    return fromArticles(`기사 ${classified.length}건 · LLM 판정`);
  }

  const parsed = parseSentimentTally(candidate.newsSentimentTally);
  const parsedTotal = parsed.positive + parsed.neutral + parsed.negative;
  if (parsedTotal > 0) {
    const neutral = parsed.neutral + Math.max(candidate.newsCount - parsedTotal, 0);
    return {
      positive: parsed.positive,
      neutral,
      negative: parsed.negative,
      total: parsed.positive + neutral + parsed.negative,
      basis: "LLM 집계 기준",
    };
  }

  return fromArticles(`기사 ${classified.length}건 · 키워드 추정`);
}

function MetricTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="metric-tile">
      <span className="metric-tile__label">{label}</span>
      <strong className={`metric-tile__value ${tone ?? ""}`}>{value}</strong>
      {sub ? <small className="metric-tile__sub">{sub}</small> : null}
    </div>
  );
}

function ReportKpiCard({
  icon,
  label,
  sub,
  tone,
  value,
}: {
  icon: string;
  label: string;
  sub: string;
  tone?: string;
  value: string;
}) {
  return (
    <article className="report-kpi-card">
      <span className="report-kpi-card__icon" aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong className={tone}>{value}</strong>
      <span>{sub}</span>
    </article>
  );
}

function EvidenceReportDashboard({ candidate }: { candidate: AiCandidate }) {
  const tones = newsToneCounts(candidate);
  const total = tones.total;
  const positivePct = total > 0 ? (tones.positive / total) * 100 : 0;
  const neutralPct = total > 0 ? (tones.neutral / total) * 100 : 0;
  const tone = sentimentTone(candidate.finalSentiment);
  const supplyMaxAbs = Math.max(Math.abs(candidate.foreignNetBuy), Math.abs(candidate.instNetBuy), Math.abs(candidate.totalSupplyNetBuy), 1);
  const supplyDays = candidate.foreignPositiveDays + candidate.instPositiveDays;
  const supplyDayTotal = Math.max(candidate.supplyWindow * 2, 1);
  const supplyParticipationScore = clampPercent((supplyDays / supplyDayTotal) * 100);
  const signalBars = [
    {
      label: "모델 순위 백분위",
      value: candidate.rank > 0 && candidate.poolSize > 1 ? 100 * (candidate.poolSize - candidate.rank) / (candidate.poolSize - 1) : 0,
      tone: (candidate.ensemblePredReturn ?? 0) >= 0 ? "up" : "down",
    },
    ...(candidate.finalPredReturn != null ? [] : [{
      label: "뉴스",
      value: candidate.newsOverallScore * 10,
      tone: candidate.newsOverallScore >= 5 ? "up" : "down",
    }]),
    {
      label: "수급",
      value: supplyParticipationScore,
      tone: candidate.totalSupplyNetBuy >= 0 ? "up" : "down",
    },
    {
      label: candidate.finalPredReturn != null ? "최종 상대순위" : "최종",
      value: candidate.finalCombinedScore,
      tone,
    },
  ];

  return (
    <section className="detail-card report-dashboard reco-reveal" style={{ animationDelay: "80ms" }}>
      <header className="report-dashboard__head">
        <div>
          <h2>AI 근거 리포트 대시보드</h2>
          <p className="detail-card-sub">모델 예측, 뉴스 감성, 수급 흐름을 한 화면에서 비교합니다.</p>
        </div>
        <strong className={`report-dashboard__verdict tone-${tone}`}>{candidate.finalSentimentKo}</strong>
      </header>

      <div className="report-kpi-grid">
        <ReportKpiCard
          icon="AI"
          label={candidate.finalPredReturn != null ? "전체 상대순위" : "최종 결합 점수"}
          value={`${Math.round(candidate.finalCombinedScore)}점`}
          sub={candidate.finalPredReturn != null ? "예상수익률 순위 · 상승확률 아님" : "모델+뉴스+수급"}
          tone={tone === "up" ? "is-positive-text" : tone === "down" ? "is-negative-text" : undefined}
        />
        <ReportKpiCard
          icon="P"
          label="예측수익률"
          value={candidate.ensemblePredReturn === null ? "—" : `${(candidate.ensemblePredReturn * 100).toFixed(2)}%`}
          sub={`${candidate.rank}위 / ${candidate.poolSize}개`}
          tone={(candidate.ensemblePredReturn ?? 0) >= 0 ? "is-positive-text" : "is-negative-text"}
        />
        <ReportKpiCard
          icon="N"
          label="뉴스 분석"
          value={`${candidate.newsCount}건`}
          sub={candidate.finalPredReturn != null
            ? (candidate.newsApplied ? `보정 ${formatAdjustmentPp(candidate.newsAdjustment)} 적용` : "뉴스 보정 미적용")
            : `${candidate.newsOverallScore.toFixed(1)} / 10`}
          tone={candidate.newsOverallScore >= 5 ? "is-positive-text" : "is-negative-text"}
        />
        <ReportKpiCard
          icon="F"
          label="수급 합산"
          value={formatEok(candidate.totalSupplyNetBuy)}
          sub={`매수 우위 ${supplyDays}/${supplyDayTotal}일`}
          tone={candidate.totalSupplyNetBuy >= 0 ? "is-positive-text" : "is-negative-text"}
        />
      </div>

      <div className="report-chart-grid">
        <article className="report-chart-card">
          <div className="report-chart-card__head">
            <strong>뉴스 감성 비율</strong>
            <span>{tones.basis}</span>
          </div>
          <div className="sentiment-donut-wrap">
            <div
              className="sentiment-donut"
              style={{
                background: `conic-gradient(var(--news-sentiment-positive) 0 ${positivePct}%, var(--report-neutral) ${positivePct}% ${
                  positivePct + neutralPct
                }%, var(--news-sentiment-negative) ${positivePct + neutralPct}% 100%)`,
              }}
              role="img"
              aria-label={`긍정 ${tones.positive}건, 중립 ${tones.neutral}건, 부정 ${tones.negative}건`}
            >
              <span>{total}</span>
              <small>기사</small>
            </div>
            <div className="sentiment-legend">
              <span><i className="is-positive" />긍정 {tones.positive}건 · {formatRatio(tones.positive, total)}</span>
              <span><i className="is-neutral" />중립 {tones.neutral}건 · {formatRatio(tones.neutral, total)}</span>
              <span><i className="is-negative" />부정 {tones.negative}건 · {formatRatio(tones.negative, total)}</span>
            </div>
          </div>
        </article>

        <article className="report-chart-card">
          <div className="report-chart-card__head">
            <strong>카테고리별 근거 점수</strong>
            <span>0-100</span>
          </div>
          <div className="report-bar-chart" aria-label="근거 점수 막대 차트">
            {signalBars.map((bar) => (
              <div className="report-bar" key={bar.label}>
                <span>{bar.label}</span>
                <div className="report-bar__track">
                  <i className={`report-bar__fill report-bar__fill--${bar.tone}`} style={{ width: `${Math.max(4, clampPercent(bar.value))}%` }} />
                </div>
                <strong>{Math.round(bar.value)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="report-supply-panel">
        <div className="report-supply-panel__summary">
          <MetricTile
            label="외국인+기관 합산"
            value={formatEok(candidate.totalSupplyNetBuy)}
            sub="최근 누적 순매수 금액"
            tone={candidate.totalSupplyNetBuy >= 0 ? "is-positive-text" : "is-negative-text"}
          />
          <MetricTile
            label="매수 우위 일수"
            value={`${supplyDays}/${supplyDayTotal}일`}
            sub="외국인·기관 합산 관찰"
            tone={supplyDays >= supplyDayTotal / 2 ? "is-positive-text" : "is-negative-text"}
          />
        </div>
        <div className="supply-grid">
          <SupplyRow
            label="외국인"
            won={candidate.foreignNetBuy}
            days={candidate.foreignPositiveDays}
            maxAbs={supplyMaxAbs}
            window={candidate.supplyWindow}
          />
          <SupplyRow
            label="기관"
            won={candidate.instNetBuy}
            days={candidate.instPositiveDays}
            maxAbs={supplyMaxAbs}
            window={candidate.supplyWindow}
          />
        </div>
      </div>
    </section>
  );
}

function SupplyRow({
  days,
  label,
  maxAbs,
  window,
  won,
}: {
  days: number;
  label: string;
  maxAbs: number;
  window: number;
  won: number;
}) {
  const tone = won >= 0 ? "is-positive-text" : "is-negative-text";
  const amountFill = maxAbs > 0 ? Math.max(8, Math.min(100, (Math.abs(won) / maxAbs) * 100)) : 0;
  const dayFill = clampPercent((days / Math.max(window, 1)) * 100);
  return (
    <div className="supply-row">
      <span className="supply-row__label">{label}</span>
      <div className="supply-row__bar">
        <i className={won >= 0 ? "is-positive" : "is-negative"} style={{ width: `${amountFill}%` }} />
      </div>
      <strong className={`supply-row__won ${tone}`}>{formatEok(won)}</strong>
      <small className="supply-row__days">매수 우위 {days}/{window}일</small>
      <div className="supply-row__daysbar" aria-hidden="true">
        <i style={{ width: `${Math.max(dayFill, 4)}%` }} />
      </div>
    </div>
  );
}

function AiRecommendation({ candidate }: { candidate: AiCandidate }) {
  const tone = sentimentTone(candidate.finalSentiment);
  const supplyDays = candidate.foreignPositiveDays + candidate.instPositiveDays;
  const supplyDayTotal = Math.max(candidate.supplyWindow * 2, 1);
  const { groups: newsGroups, items: newsItems, keywordCount } = groupedNews(candidate.news);

  const renderNewsItem = (item: ClassifiedNews) => (
    <li key={item.index}>
      <a className={`ai-news-list__link is-${item.tone}`} href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="ai-news-list__top">
          <span className="ai-news-list__title">{item.title}</span>
          <span
            className={`ai-news-badge is-${item.tone}`}
            title={item.toneSource === "keyword" ? "LLM 분석 없이 키워드로 추정한 분류" : undefined}
          >
            {item.toneLabel}
            {item.toneSource === "keyword" ? " · 추정" : null}
          </span>
        </span>
        {item.description ? <span className="ai-news-list__desc">{item.description}</span> : null}
        {item.toneReason ? <span className="ai-news-list__reason">{item.toneReason}</span> : null}
        <small className="ai-news-list__meta">
          {item.source} · {item.pubDate?.slice(0, 10)}
        </small>
      </a>
    </li>
  );

  return (
    <>
      <section className="detail-card ai-reco reco-reveal">
        <div className="ai-reco__head">
          <span className="ai-reco__eyebrow">선정 근거 요약</span>
          <h2>
            AI는 이 종목을 <em className={`tone-${tone}`}>{candidate.finalSentimentKo}</em> 후보로 선정했습니다
          </h2>
        </div>

        <div className="reco-grid">
          <RankSummary candidate={candidate} />
          <div className="metric-tiles">
            <MetricTile
              label="다음 거래일 예측수익률"
              value={candidate.ensemblePredReturn === null ? "—" : `${(candidate.ensemblePredReturn * 100).toFixed(2)}%`}
              sub="시가→종가 · Huber 앙상블"
              tone={(candidate.ensemblePredReturn ?? 0) >= 0 ? "is-positive-text" : "is-negative-text"}
            />
            <MetricTile
              label={candidate.finalPredReturn != null ? "뉴스 보정" : "뉴스 점수"}
              value={candidate.finalPredReturn != null
                ? (candidate.newsApplied ? formatAdjustmentPp(candidate.newsAdjustment) : "미적용")
                : `${candidate.newsOverallScore.toFixed(1)} / 10`}
              sub={candidate.newsSentimentTally || `뉴스 ${candidate.newsCount}건`}
            />
            <MetricTile
              label="외국인·기관 수급"
              value={formatEok(candidate.totalSupplyNetBuy)}
              sub={`매수 우위 ${supplyDays}/${supplyDayTotal}일`}
              tone={candidate.totalSupplyNetBuy >= 0 ? "is-positive-text" : "is-negative-text"}
            />
          </div>
        </div>

        <div className="reco-reason">
          <span className="reco-reason__tag">핵심 근거</span>
          <p>
            {[candidate.summary, candidate.tradingInsight].filter(Boolean).join(" ")}
          </p>
        </div>

        <p className="reco-disclaimer">
          순위는 KOSPI200 종목 사이에서 다음 거래일 예측수익률을 비교한 상대 순위입니다. 상승 확률이나 수익을 뜻하지
          않으며, 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다.
        </p>
      </section>

      <EvidenceReportDashboard candidate={candidate} />

      <section className="detail-card reco-reveal" style={{ animationDelay: "160ms" }}>
        <h2>분석에 사용한 뉴스 ({candidate.news.length})</h2>
        {keywordCount > 0 ? (
          <p className="detail-card-sub">
            {keywordCount === candidate.news.length ? "모든" : `${keywordCount}건의`} 기사는 기사별 LLM 판정이 없어 제목·요약의
            키워드로 긍정·부정을 추정했습니다. "추정" 배지는 참고용이며 위 감성 비율(LLM 집계)과 다를 수 있습니다.
          </p>
        ) : null}
        {candidate.news.length > 0 && keywordCount > 0 ? (
          // Guessed tones aren't authoritative enough to group by: list in source order.
          <ul className="ai-news-list ai-news-list--flat">{newsItems.map(renderNewsItem)}</ul>
        ) : candidate.news.length > 0 ? (
          <div className="ai-news-groups">
            {newsGroups.map((group) => (
              <section className={`ai-news-group ai-news-group--${group.tone}`} key={group.tone}>
                <div className={`ai-news-group__head is-${group.tone}`}>
                  <strong>{group.label}</strong>
                  <span>{group.items.length}건</span>
                </div>
                <ul className="ai-news-list">{group.items.map(renderNewsItem)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="factor-empty">분석에 사용된 뉴스 항목이 없습니다.</p>
        )}
      </section>
    </>
  );
}

export function StockDetailPage() {
  const { code = "" } = useParams<{ code: string }>();
  const normalized = code.replace(/\D/g, "").padStart(6, "0").slice(-6);

  const dashboard = getMarketDashboardData();
  const dashboardStock: StockQuote | undefined =
    dashboard.stocks.find((item) => item.code === normalized) ??
    dashboard.watchlist.find((item) => item.code === normalized);
  const [liveStock, setLiveStock] = useState<StockQuote | undefined>();
  const stock = liveStock ?? dashboardStock;

  // Bundled output shows instantly; the live pipeline result (after a real run)
  // overrides it once fetched.
  const [candidate, setCandidate] = useState<AiCandidate | undefined>(() => getAiCandidate(normalized));
  const [isSyncing, setSyncing] = useState(false);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSyncing(true);
    fetchStockAnalysis(normalized, controller.signal)
      .then((row) => {
        if (active && row) {
          setCandidate(rowToCandidate(row));
          setIsLive(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          setSyncing(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [normalized]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetchStockQuoteData(normalized, controller.signal)
      .then((quote) => {
        if (active && quote) {
          setLiveStock(quote);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      controller.abort();
    };
  }, [normalized]);

  usePageTitle(candidate ? `${candidate.companyName} ${normalized}` : stock ? `${stock.name} ${stock.code}` : "종목 상세");

  const [watchCodes, setWatchCodes] = useState<string[]>(() => readWatchlistCodes() ?? []);
  useEffect(() => {
    writeWatchlistCodes(watchCodes);
  }, [watchCodes]);

  const displayName = candidate?.companyName ?? stock?.name ?? normalized;
  const isWatched = watchCodes.includes(normalized);

  function toggleWatch() {
    setWatchCodes((current) =>
      current.includes(normalized) ? current.filter((item) => item !== normalized) : [normalized, ...current],
    );
  }

  if (!candidate && !stock) {
    return (
      <>
        <MarketTopBar stocks={dashboard.stocks} />
        <main className="page-status">
          <div className="status-view">
            <strong>분석 데이터가 없습니다</strong>
            <p>종목코드 {normalized || "(없음)"}에 대한 시세나 AI 분석 결과를 찾을 수 없습니다.</p>
            <Link className="detail-back-link" to="/dashboard">
              ← 대시보드로 돌아가기
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
    <MarketTopBar stocks={dashboard.stocks} />
    <main className="stock-detail-page">
      <div className="detail-back-row">
        <Link className="detail-back-link" to="/dashboard">
          ← 실시간 대시보드
        </Link>
        <span className="detail-source-flag">
          {isSyncing ? "최신 분석 동기화 중…" : isLive ? "실시간 파이프라인 결과" : "최근 생성된 분석 결과"}
        </span>
      </div>

      <header className="detail-hero">
        <div className="detail-hero__id">
          <span className="detail-hero__eyebrow">AI 후보 리포트</span>
          <h1>
            {displayName} <small>{normalized}</small>
          </h1>
          <p className="detail-hero__market">{stock?.isKospi200 ? "KOSPI · KOSPI200" : "KOSPI"}</p>
        </div>
        {stock ? (
          <div className="detail-hero__price">
            <strong>{formatWon(stock.currentPrice)}</strong>
            <span className={changeTone(stock.change)}>
              {formatWon(stock.change)} ({formatRate(stock.changeRate)}) · {directionLabel(stock.direction)}
            </span>
          </div>
        ) : null}
        <button className={`report-button ${isWatched ? "is-active" : ""}`} onClick={toggleWatch} type="button">
          {isWatched ? "관심 해제" : "관심 추가"}
        </button>
      </header>

      {stock ? (
        <section className="detail-card">
          <h2>가격 차트</h2>
          <StockChartPanel stock={stock} />
        </section>
      ) : null}

      {candidate ? (
        <AiRecommendation candidate={candidate} />
      ) : (
        <section className="detail-card">
          <p className="factor-empty">이 종목은 이번 AI 분석의 후보에 포함되지 않았습니다.</p>
        </section>
      )}

      <footer className="detail-sources">
        <h2>데이터 출처 및 유의사항</h2>
        <ul>
          <li>다음 거래일 시가→종가 예측수익률·순위: Huber 회귀 앙상블{candidate?.baseDate ? ` (기준일 ${candidate.baseDate})` : ""}.</li>
          <li>수급(외국인·기관 순매수): 최근 거래일 누적 순매수 금액.</li>
          <li>뉴스·감성: 네이버 뉴스 기사를 Gemini로 구조화 분석한 결과. LLM 결과가 없는 기사는 키워드로 추정합니다.</li>
        </ul>
        <p className="panel-note">
          현재 시세는 KIS quote API를 우선 조회하며, 조회 실패 시 최근 대시보드 캐시를 표시합니다. 본 리포트는
          투자 참고용이며 투자 손익에 대한 책임은 투자자 본인에게 있습니다.
        </p>
      </footer>
    </main>
    </>
  );
}
