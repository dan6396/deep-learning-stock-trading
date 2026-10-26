import { finiteNumber, nonnegativeInteger, record, stockCode, textValue } from "./value";
import { formatNumber } from "../shared/lib/format";
import { adaptModelEvidence, type ModelEvidence } from "./modelEvidence";
import { adaptDiversification } from "./stockInsight";
import type { Diversification } from "./stockInsight";

export type BriefingStatus = "ready" | "no_run";

export type BriefingModelMeta = {
  modelId: string;
  scoreKind: "rank_zscore";
  baseDate: string;
  predictionTarget: string | null;
  poolSize: number;
  runStartedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
};

export type MacroIndicatorId = "KOSPI" | "KOSDAQ" | "NASDAQ" | "SP500" | "USDKRW" | "UST10Y" | "KOSPI200_NIGHT";
export type MacroIndicatorUnit = "pt" | "KRW" | "%";
export type MacroIndicatorSource = "yahoo" | "kis" | "unknown";
export type MacroIndicatorStatus = "ok" | "unavailable";
export type MacroSession = "closed" | "open" | null;

export type MacroIndicator = {
  id: MacroIndicatorId;
  name: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
  unit: MacroIndicatorUnit;
  asOf: string | null;
  source: MacroIndicatorSource;
  status: MacroIndicatorStatus;
  session?: MacroSession;
};

export type MacroContext = {
  usSessionDate: string | null;
  targetSessionNote: string;
};

export type ReferenceDefinition = "close_to_close" | "open_to_close";
export type ReferenceCondition = "nasdaq_up" | "nasdaq_down";

export type ReferenceRow = {
  definition: ReferenceDefinition;
  label: string;
  condition: ReferenceCondition;
  ratioPct: number;
  count: number;
  total: number;
  baselinePct: number;
  ciLowPct: number | null;
  ciHighPct: number | null;
};

export type MacroReference = {
  title: string;
  periodStart: string | null;
  periodEnd: string | null;
  lastObservedDate: string | null;
  rows: ReferenceRow[];
  note: string;
  source: string;
};

export type MacroData = {
  asOf: string | null;
  indicators: MacroIndicator[];
  context?: MacroContext;
  reference?: MacroReference | null;
};

export type EvidenceKind = "model" | "supply" | "news";

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  text: string;
};

export type CautionKind = "model" | "supply" | "news" | "macro" | "data";

export type CautionItem = {
  id: string;
  kind: CautionKind;
  text: string;
};

export type NewsArticle = {
  id: string;
  title: string;
  url: string;
  source: string;
  pubDate: string | null;
};

export type StockNewsStatus = "collected" | "collection_failed" | "not_collected";

export type StockNews = {
  status: StockNewsStatus;
  articles: NewsArticle[];
};

export type BriefingStock = {
  modelEvidence?: ModelEvidence | null;
  rank: number;
  code: string;
  name: string;
  rankScore: number | null;
  poolSize: number | null;
  topPercent: number | null;
  evidence: EvidenceItem[];
  cautions: CautionItem[];
  news: StockNews;
};

export type FieldSource = "llm" | "template";

export type NarrativeFieldSources = {
  overview?: FieldSource;
  marketNote?: FieldSource;
};

export type StockNarrative = {
  code: string;
  summary: string;
  citations: string[];
  source?: FieldSource;
};

export type NarrativeStatus = "llm" | "template";

export type BriefingNarrative = {
  status: NarrativeStatus;
  generatedAt: string;
  llmModel: string | null;
  inputHash: string;
  fallbackReason: string | null;
  overview: string;
  marketNote: string;
  stocks: StockNarrative[];
  citations: string[];
  macroAsOf?: string | null;
  macroStale?: boolean;
  fieldSources?: NarrativeFieldSources;
};

export type BriefingDataSource = "live" | "cache" | "sample";

export type BriefingDataMeta = {
  source: BriefingDataSource;
  asOf: string | null;
};

export type CompositionBasis = "equal_weight_reference";

export type CompositionSector = {
  name: string;
  codes: string[];
};

export type CompositionRecentReturn = {
  date: string;
  returnPct: number;
};

export type CompositionPerformance = {
  asOf: string | null;
  measuredDays: number;
  averageReturnPct: number | null;
  positiveDays: number | null;
  recent: CompositionRecentReturn[];
};

export type BriefingComposition = {
  diversification?: Diversification | null;
  basis: CompositionBasis;
  note: string;
  sectors: CompositionSector[] | null;
  sectorSource: string | null;
  performance: CompositionPerformance | null;
  commonCautions: string[];
};

export type BriefingPayload = {
  previousRun?: { reason: "running" | "failed" };
  version: 1;
  status: BriefingStatus;
  kind?: "official" | "adhoc" | "unknown";
  model: BriefingModelMeta | null;
  macro: MacroData;
  stocks: BriefingStock[];
  narrative: BriefingNarrative;
  composition?: BriefingComposition | null;
  disclaimer: string;
  data_meta: BriefingDataMeta;
};

/** Repeated boilerplate belongs in the page disclaimer and model-table help. */
export function withoutRankScoreDisclaimer(value: string): string {
  return value.replace(/(?:모델(?:의)?\s*)?(?:순위\s*점수|해당\s*점수)는\s*(?:실제\s*)?(?:기대\s*수익률|상승\s*확률|수익률|확률)(?:\s*(?:·|이나|나|과|와|\/)\s*(?:기대\s*수익률|상승\s*확률|수익률|확률))*\s*(?:이|가|을|를)?\s*(?:아닙니다|아님|의미하지\s*않습니다)[.!。]?\s*/g, "").trim();
}

const VALID_MACRO_IDS: readonly MacroIndicatorId[] = ["KOSPI", "KOSDAQ", "NASDAQ", "SP500", "USDKRW", "UST10Y", "KOSPI200_NIGHT"];
const DEFAULT_MACRO_NAMES: Record<MacroIndicatorId, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  NASDAQ: "나스닥",
  SP500: "S&P 500",
  USDKRW: "원/달러 환율",
  UST10Y: "미국채 10년물",
  KOSPI200_NIGHT: "코스피200 야간선물",
};

export function adaptMacroIndicator(raw: unknown): MacroIndicator | null {
  const obj = record(raw);
  const idRaw = String(obj.id ?? "").toUpperCase();
  if (!(VALID_MACRO_IDS as readonly string[]).includes(idRaw)) {
    return null; // 알 수 없는 indicator id는 제외
  }
  const id = idRaw as MacroIndicatorId;
  const name = textValue(obj.name) ?? DEFAULT_MACRO_NAMES[id];
  const value = finiteNumber(obj.value);
  const change = finiteNumber(obj.change);
  const changePct = finiteNumber(obj.changePct);
  const unit: MacroIndicatorUnit = obj.unit === "%" ? "%" : obj.unit === "KRW" ? "KRW" : "pt";
  const asOf = textValue(obj.asOf);
  const rawSource = obj.source;
  const source: MacroIndicatorSource = rawSource === "yahoo" ? "yahoo" : rawSource === "kis" ? "kis" : "unknown";
  const status: MacroIndicatorStatus = obj.status === "ok" && value !== null ? "ok" : "unavailable";
  const session: MacroSession = obj.session === "open" ? "open" : obj.session === "closed" ? "closed" : null;

  return {
    id,
    name,
    value,
    change,
    changePct,
    unit,
    asOf,
    source,
    status,
    ...(session !== null ? { session } : {}),
  };
}

export function adaptMacroContext(raw: unknown): MacroContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = record(raw);
  const targetSessionNote = textValue(obj.targetSessionNote);
  if (!targetSessionNote) return undefined;
  const usSessionDate = textValue(obj.usSessionDate);
  return {
    usSessionDate: usSessionDate && /^\d{4}-\d{2}-\d{2}$/.test(usSessionDate) ? usSessionDate : null,
    targetSessionNote,
  };
}

export function adaptReferenceRow(raw: unknown): ReferenceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const defRaw = textValue(obj.definition);
  if (defRaw !== "open_to_close" && defRaw !== "close_to_close") return null;
  const definition: ReferenceDefinition = defRaw;
  const label = textValue(obj.label);
  if (!label) return null;
  const condRaw = textValue(obj.condition);
  if (condRaw !== "nasdaq_up" && condRaw !== "nasdaq_down") return null;
  const condition: ReferenceCondition = condRaw;
  const ratioPct = finiteNumber(obj.ratioPct);
  if (ratioPct === null) return null;
  const count = nonnegativeInteger(obj.count);
  if (count === null) return null;
  const total = nonnegativeInteger(obj.total);
  if (total === null) return null;
  const baselinePct = finiteNumber(obj.baselinePct);
  if (baselinePct === null) return null;
  const ciLowPct = finiteNumber(obj.ciLowPct);
  const ciHighPct = finiteNumber(obj.ciHighPct);

  return {
    definition,
    label,
    condition,
    ratioPct,
    count,
    total,
    baselinePct,
    ciLowPct,
    ciHighPct,
  };
}

export function adaptMacroReference(raw: unknown): MacroReference | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const title = textValue(obj.title);
  if (!title) return null;
  const periodStart = textValue(obj.periodStart);
  const periodEnd = textValue(obj.periodEnd);
  const lastObservedDate = textValue(obj.lastObservedDate);
  const rowsRaw = Array.isArray(obj.rows) ? obj.rows : [];
  const rows = rowsRaw
    .map(adaptReferenceRow)
    .filter((r): r is ReferenceRow => r !== null);
  const note = textValue(obj.note) ?? "";
  const source = textValue(obj.source) ?? "";

  return {
    title,
    periodStart,
    periodEnd,
    lastObservedDate,
    rows,
    note,
    source,
  };
}

export function adaptMacroData(raw: unknown): MacroData {
  const obj = record(raw);
  const asOf = textValue(obj.asOf);
  const indicatorsRaw = Array.isArray(obj.indicators) ? obj.indicators : [];
  const indicators = indicatorsRaw
    .map(adaptMacroIndicator)
    .filter((ind): ind is MacroIndicator => ind !== null);
  const context = adaptMacroContext(obj.context);
  const reference = adaptMacroReference(obj.reference);

  return {
    asOf,
    indicators,
    ...(context ? { context } : {}),
    ...(reference !== null ? { reference } : "reference" in obj ? { reference: null } : {}),
  };
}

export function adaptEvidenceItem(raw: unknown, defaultId: string): EvidenceItem | null {
  const obj = record(raw);
  const text = textValue(obj.text);
  if (!text) return null;
  const id = textValue(obj.id) ?? defaultId;
  const kind: EvidenceKind = obj.kind === "supply" ? "supply" : obj.kind === "news" ? "news" : "model";
  return { id, kind, text };
}

export function adaptCautionItem(raw: unknown, defaultId: string): CautionItem | null {
  const obj = record(raw);
  const text = textValue(obj.text);
  if (!text) return null;
  const id = textValue(obj.id) ?? defaultId;
  const kindChoice = obj.kind;
  const kind: CautionKind =
    kindChoice === "supply" || kindChoice === "news" || kindChoice === "macro" || kindChoice === "data"
      ? kindChoice
      : "model";
  return { id, kind, text };
}

export function adaptNewsArticle(raw: unknown, _defaultId: string): NewsArticle | null {
  const obj = record(raw);
  const id = textValue(obj.id);
  const title = textValue(obj.title);
  const url = textValue(obj.url);
  const source = textValue(obj.source);
  if (!id || !title || !url || !source) return null;
  const pubDate = textValue(obj.pubDate);
  return { id, title, url, source, pubDate };
}

export function adaptStockNews(raw: unknown): StockNews {
  const obj = record(raw);
  const status: StockNewsStatus =
    obj.status === "collected" || obj.status === "collection_failed" ? obj.status : "not_collected";
  const articlesRaw = Array.isArray(obj.articles) ? obj.articles : [];
  const articles = articlesRaw.map((article, index) => adaptNewsArticle(article, `N:unknown:${index + 1}`)).filter((article): article is NewsArticle => article !== null);
  return { status, articles };
}

export function adaptBriefingStock(raw: unknown, _defaultRank: number): BriefingStock | null {
  const obj = record(raw);
  const code = stockCode(obj.code);
  const name = textValue(obj.name);
  const rank = nonnegativeInteger(obj.rank);
  if (!code || !name || rank === null || rank < 1) return null;
  const rankScore = finiteNumber(obj.rankScore);
  const rawPoolSize = nonnegativeInteger(obj.poolSize);
  const poolSize = rawPoolSize !== null && rawPoolSize >= rank ? rawPoolSize : null;
  const rawTopPercent = finiteNumber(obj.topPercent);
  const topPercent = rawTopPercent !== null && rawTopPercent >= 0 && rawTopPercent <= 100 ? rawTopPercent : null;

  const evidenceRaw = Array.isArray(obj.evidence) ? obj.evidence : [];
  const evidence = evidenceRaw
    .map((e, idx) => adaptEvidenceItem(e, `E:${code}:${idx + 1}`))
    .filter((e): e is EvidenceItem => e !== null);

  const cautionsRaw = Array.isArray(obj.cautions) ? obj.cautions : [];
  const cautions = cautionsRaw
    .map((c, idx) => adaptCautionItem(c, `C:${code}:${idx + 1}`))
    .filter((c): c is CautionItem => c !== null);

  const news = adaptStockNews(obj.news);

  return {
    rank,
    code,
    name,
    rankScore,
    poolSize,
    topPercent,
    evidence,
    cautions,
    news,
    modelEvidence: adaptModelEvidence(obj.modelEvidence),
  };
}

export function adaptStockNarrative(raw: unknown): StockNarrative | null {
  const obj = record(raw);
  const code = stockCode(obj.code);
  const summary = textValue(obj.summary);
  if (!code || !summary) return null;
  const citationsRaw = Array.isArray(obj.citations) ? obj.citations : [];
  const citations = citationsRaw.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  const source: FieldSource | undefined =
    obj.source === "llm" || obj.source === "template" ? obj.source : undefined;
  return { code, summary, citations, ...(source ? { source } : {}) };
}

export function adaptBriefingNarrative(raw: unknown): BriefingNarrative {
  const obj = record(raw);
  const status: NarrativeStatus = obj.status === "llm" ? "llm" : "template";
  const generatedAt = textValue(obj.generatedAt) ?? "";
  const llmModel = textValue(obj.llmModel);
  const inputHash = textValue(obj.inputHash) ?? "";
  const fallbackReason = textValue(obj.fallbackReason);
  const overview = textValue(obj.overview) ?? "";
  const marketNote = textValue(obj.marketNote) ?? "";
  const stocksRaw = Array.isArray(obj.stocks) ? obj.stocks : [];
  const stocks = stocksRaw.map(adaptStockNarrative).filter((stock): stock is StockNarrative => stock !== null);
  const citationsRaw = Array.isArray(obj.citations) ? obj.citations : [];
  const citations = citationsRaw.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  const macroAsOf = typeof obj.macroAsOf === "string" ? textValue(obj.macroAsOf) : obj.macroAsOf === null ? null : undefined;
  const macroStale = typeof obj.macroStale === "boolean" ? obj.macroStale : undefined;

  const rawFieldSources = record(obj.fieldSources);
  const overviewSource: FieldSource | undefined =
    rawFieldSources.overview === "llm" || rawFieldSources.overview === "template" ? rawFieldSources.overview : undefined;
  const marketNoteSource: FieldSource | undefined =
    rawFieldSources.marketNote === "llm" || rawFieldSources.marketNote === "template" ? rawFieldSources.marketNote : undefined;
  const fieldSources: NarrativeFieldSources | undefined =
    overviewSource || marketNoteSource
      ? {
          ...(overviewSource ? { overview: overviewSource } : {}),
          ...(marketNoteSource ? { marketNote: marketNoteSource } : {}),
        }
      : undefined;

  return {
    status,
    generatedAt,
    llmModel,
    inputHash,
    fallbackReason,
    overview,
    marketNote,
    stocks,
    citations,
    ...(macroAsOf !== undefined ? { macroAsOf } : {}),
    ...(macroStale !== undefined ? { macroStale } : {}),
    ...(fieldSources !== undefined ? { fieldSources } : {}),
  };
}

export function adaptBriefingModel(raw: unknown): BriefingModelMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const modelId = textValue(obj.modelId);
  const baseDate = textValue(obj.baseDate);
  if (!modelId || !baseDate) return null;
  return {
    modelId,
    scoreKind: "rank_zscore",
    baseDate,
    predictionTarget: textValue(obj.predictionTarget),
    poolSize: nonnegativeInteger(obj.poolSize) ?? 0,
    runStartedAt: textValue(obj.runStartedAt),
    finishedAt: typeof obj.finishedAt === "string" && Number.isFinite(Date.parse(obj.finishedAt)) ? obj.finishedAt : null,
    elapsedMs: typeof obj.elapsedMs === "number" && Number.isFinite(obj.elapsedMs) && obj.elapsedMs >= 0 ? obj.elapsedMs : null,
  };
}

export function adaptCompositionSector(raw: unknown): CompositionSector | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const name = textValue(obj.name);
  if (!name) return null;
  const codesRaw = Array.isArray(obj.codes) ? obj.codes : [];
  const codes = codesRaw
    .map((c) => stockCode(c))
    .filter((c): c is string => c !== null);
  return { name, codes };
}

export function adaptCompositionRecentReturn(raw: unknown): CompositionRecentReturn | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const date = textValue(obj.date);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const returnPct = finiteNumber(obj.returnPct);
  if (returnPct === null) return null;
  return { date, returnPct };
}

export function adaptCompositionPerformance(raw: unknown): CompositionPerformance | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const measuredDays = nonnegativeInteger(obj.measuredDays);
  if (measuredDays === null) return null;
  const asOf = textValue(obj.asOf);
  const averageReturnPct = finiteNumber(obj.averageReturnPct);
  const positiveDays = nonnegativeInteger(obj.positiveDays);
  const recentRaw = Array.isArray(obj.recent) ? obj.recent : [];
  const recent = recentRaw
    .map(adaptCompositionRecentReturn)
    .filter((r): r is CompositionRecentReturn => r !== null);
  return {
    asOf,
    measuredDays,
    averageReturnPct,
    positiveDays,
    recent,
  };
}

export function adaptBriefingComposition(raw: unknown): BriefingComposition | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = record(raw);
  const note = textValue(obj.note);
  if (note === null && !("sectors" in obj) && !("basis" in obj) && !("performance" in obj)) return null;
  const basis: CompositionBasis = "equal_weight_reference";
  const sectorsRaw = obj.sectors;
  const sectors: CompositionSector[] | null = Array.isArray(sectorsRaw)
    ? sectorsRaw
        .map(adaptCompositionSector)
        .filter((s): s is CompositionSector => s !== null)
    : null;
  const sectorSource = textValue(obj.sectorSource);
  const performance = adaptCompositionPerformance(obj.performance);
  const cautionsRaw = Array.isArray(obj.commonCautions) ? obj.commonCautions : [];
  const commonCautions = cautionsRaw.filter((c): c is string => typeof c === "string" && c.trim().length > 0);

  return {
    basis,
    note: note ?? "",
    sectors,
    sectorSource,
    performance,
    commonCautions,
    diversification: adaptDiversification(obj.diversification),
  };
}

export function adaptBriefing(value: unknown): BriefingPayload {
  const root = record(value);
  const status: BriefingStatus = root.status === "ready" ? "ready" : "no_run";
  const model = adaptBriefingModel(root.model);
  const macro = adaptMacroData(root.macro);
  const stocksRaw = Array.isArray(root.stocks) ? root.stocks : [];
  const stocks = stocksRaw
    .map((s, idx) => adaptBriefingStock(s, idx + 1))
    .filter((s): s is BriefingStock => s !== null);
  const narrative = adaptBriefingNarrative(root.narrative);
  const composition = adaptBriefingComposition(root.composition);
  const disclaimer =
    textValue(root.disclaimer) ??
    "본 화면의 모델 예측과 요약은 투자 권유나 매매 추천이 아니며, 실제 투자 결과에 대한 책임을 지지 않습니다.";
  const metaObj = record(root.data_meta);
  const source: BriefingDataSource =
    metaObj.source === "live" ? "live" : metaObj.source === "sample" ? "sample" : "cache";
  const asOf = textValue(metaObj.asOf);

  return {
    version: 1,
    status,
    kind: status === "ready" && model && (root.kind === "official" || root.kind === "adhoc") ? root.kind : "unknown",
    ...(status === "ready" && (record(root.previousRun).reason === "running" || record(root.previousRun).reason === "failed")
      ? { previousRun: { reason: record(root.previousRun).reason as "running" | "failed" } } : {}),
    model,
    macro,
    stocks,
    narrative,
    ...(composition !== null ? { composition } : "composition" in root ? { composition: null } : {}),
    disclaimer,
    data_meta: { source, asOf },
  };
}

// ----------------------------------------------------
// 포맷터 유틸리티 함수들
// ----------------------------------------------------

export function formatKstTime(value: string | null | undefined): string {
  if (!value) return "시각 미확인";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 미확인";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const h = parts.find((p) => p.type === "hour")?.value;
  const min = parts.find((p) => p.type === "minute")?.value;
  return `${m}/${d} ${h}:${min} KST`;
}

export function formatMacroAsOf(indicatorId: MacroIndicatorId, asOf: string | null | undefined): string {
  if (!asOf) return "시각 미확인";
  const date = new Date(asOf);
  if (!Number.isFinite(date.getTime())) return "시각 미확인";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const h = parts.find((p) => p.type === "hour")?.value;
  const min = parts.find((p) => p.type === "minute")?.value;

  if (indicatorId === "KOSPI" || indicatorId === "KOSDAQ") {
    const hour = parseInt(h ?? "0", 10);
    const minute = parseInt(min ?? "0", 10);
    if (hour > 15 || (hour === 15 && minute >= 30)) {
      return `${m}/${d} 종가`;
    }
  }
  return `${m}/${d} ${h}:${min} KST`;
}

export function formatNewsDate(pubDate: string | null | undefined): string {
  if (!pubDate) return "시각 미확인";
  const date = new Date(pubDate);
  if (!Number.isFinite(date.getTime())) return "시각 미확인";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const h = parts.find((p) => p.type === "hour")?.value;
  const min = parts.find((p) => p.type === "minute")?.value;

  const currentYearKst = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(new Date());

  if (y !== currentYearKst) {
    return `${y}/${m}/${d} ${h}:${min} KST`;
  }
  return `${m}/${d} ${h}:${min} KST`;
}

export function formatFallbackReason(code: string | null | undefined): { text: string; isNeutral: boolean } | null {
  if (!code) return null;
  switch (code) {
    case "not_generated":
      return { text: "아직 AI 요약을 생성하지 않았습니다", isNeutral: true };
    case "auto_disabled":
      return { text: "자동 요약 생성이 꺼져 있습니다", isNeutral: true };
    case "generation_in_progress":
      return { text: "AI 요약이 현재 생성 중입니다", isNeutral: true };
    case "missing_api_key":
      return { text: "AI 요약 기능이 설정되지 않았습니다", isNeutral: false };
    case "cooldown":
      return { text: "최근 생성 요청 후 쿨다운 중입니다 (잠시 후 다시 시도해 주세요)", isNeutral: false };
    case "forbidden_content":
    case "ungrounded_number":
    case "invalid_citation":
    case "sensitive_output":
    case "invalid_schema":
      return { text: "AI 출력이 검증 기준을 통과하지 못해 규칙 기반 요약을 표시합니다", isNeutral: false };
    case "generation_timeout":
      return { text: "AI 요약 생성 시간이 초과되어 규칙 기반 요약을 표시합니다", isNeutral: false };
    case "generation_failed":
    case "invalid_model":
      return { text: "AI 요약 생성에 실패하여 규칙 기반 요약을 표시합니다", isNeutral: false };
    case "no_run":
      return { text: "분석 실행 전이므로 요약이 생성되지 않았습니다", isNeutral: true };
    case "partial_template":
      return { text: "일부 문장이 검증 기준을 통과하지 못해 규칙 기반 문장으로 대체되었습니다", isNeutral: false };
    default:
      return { text: "규칙 기반 요약을 표시합니다", isNeutral: false };
  }
}

export function formatMacroValue(indicator: MacroIndicator): string {
  if (indicator.status === "unavailable" || indicator.value === null) {
    return "미수집";
  }
  if (indicator.unit === "%") {
    return `${indicator.value.toFixed(2)}%`;
  }
  if (indicator.unit === "KRW") {
    return `${formatNumber(indicator.value, 2)}원`;
  }
  return `${formatNumber(indicator.value, 2)}pt`;
}

export type ChangeFormatResult = {
  text: string;
  signSymbol: string;
  direction: "rise" | "fall" | "flat" | "unavailable";
};

export function formatMacroChange(indicator: MacroIndicator): ChangeFormatResult {
  if (indicator.status === "unavailable" || indicator.change === null) {
    return {
      text: indicator.id === "KOSPI200_NIGHT" ? "—" : "미수집",
      signSymbol: "",
      direction: "unavailable",
    };
  }
  const change = indicator.change;
  const changePct = indicator.changePct;
  const isUp = change > 0;
  const isDown = change < 0;
  const direction: ChangeFormatResult["direction"] = isUp ? "rise" : isDown ? "fall" : "flat";
  const signSymbol = isUp ? "▲" : isDown ? "▼" : "-";

  // UST10Y 금리: 변화는 %p로 표시 (예: ▲ 0.05%p)
  if (indicator.id === "UST10Y" || indicator.unit === "%") {
    const absChange = Math.abs(change).toFixed(2);
    return {
      text: `${signSymbol} ${absChange}%p`,
      signSymbol,
      direction,
    };
  }

  // 지수 및 환율: 단위 표기 + % 등락률 함께 표기
  const unitLabel = indicator.unit === "KRW" ? "원" : "pt";
  const absChange = Math.abs(change);
  const formattedChange = formatNumber(absChange, 2);
  const pctText =
    changePct !== null && Number.isFinite(changePct)
      ? ` (${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%)`
      : "";

  return {
    text: `${signSymbol} ${formattedChange}${unitLabel}${pctText}`,
    signSymbol,
    direction,
  };
}

export function formatMacroSource(source: MacroIndicatorSource): string {
  if (source === "yahoo") return "Yahoo";
  if (source === "kis") return "KIS";
  return "출처 미확인";
}

export type ParsedCitation = {
  rawId: string;
  type: "macro" | "news" | "evidence" | "caution" | "rank" | "unknown";
  targetElementId: string;
  label: string;
  code?: string;
  index?: number;
  macroId?: string;
  isValid: boolean;
};

export function citationDomId(id: string): string {
  return "cite-" + id.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
}

const MACRO_CITATION_LABELS: Record<string, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  KOSPI200_NIGHT: "야간선물",
  NASDAQ: "나스닥",
  SP500: "S&P 500",
  USDKRW: "원·달러",
  UST10Y: "미 10년물",
};

export function parseCitation(id: string): ParsedCitation {
  const clean = id.trim();
  const targetElementId = citationDomId(clean);

  if (clean.startsWith("M:")) {
    const macroId = clean.slice(2);
    const isValid = (VALID_MACRO_IDS as readonly string[]).includes(macroId);
    return {
      rawId: clean,
      type: "macro",
      macroId,
      targetElementId,
      label: MACRO_CITATION_LABELS[macroId] ?? macroId,
      isValid,
    };
  }
  if (clean.startsWith("N:")) {
    const parts = clean.split(":");
    const code = parts[1] ?? "";
    const validIdx = /^\d+$/.test(parts[2] ?? "") && Number(parts[2]) > 0;
    const index = validIdx ? parseInt(parts[2], 10) : undefined;
    const isValid = /^\d{6}$/.test(code) && validIdx;
    return {
      rawId: clean,
      type: "news",
      code,
      index,
      targetElementId,
      label: index !== undefined ? `기사 ${index}` : clean,
      isValid,
    };
  }
  if (clean.startsWith("E:")) {
    const parts = clean.split(":");
    const code = parts[1] ?? "";
    const validIdx = /^\d+$/.test(parts[2] ?? "") && Number(parts[2]) > 0;
    const index = validIdx ? parseInt(parts[2], 10) : undefined;
    const isValid = /^\d{6}$/.test(code) && validIdx;
    return {
      rawId: clean,
      type: "evidence",
      code,
      index,
      targetElementId,
      label: index !== undefined ? `근거 ${index}` : clean,
      isValid,
    };
  }
  if (clean.startsWith("C:")) {
    const parts = clean.split(":");
    const code = parts[1] ?? "";
    const validIdx = /^\d+$/.test(parts[2] ?? "") && Number(parts[2]) > 0;
    const index = validIdx ? parseInt(parts[2], 10) : undefined;
    const isValid = /^\d{6}$/.test(code) && validIdx;
    return {
      rawId: clean,
      type: "caution",
      code,
      index,
      targetElementId,
      label: index !== undefined ? `주의 ${index}` : clean,
      isValid,
    };
  }
  if (clean.startsWith("R:")) {
    const code = clean.slice(2);
    const isValid = /^\d{6}$/.test(code);
    return {
      rawId: clean,
      type: "rank",
      code,
      targetElementId,
      label: "순위",
      isValid,
    };
  }
  return {
    rawId: clean,
    type: "unknown",
    targetElementId,
    label: clean,
    isValid: false,
  };
}
