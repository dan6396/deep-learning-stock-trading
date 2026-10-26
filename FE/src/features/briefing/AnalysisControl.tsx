import { useRef, useState } from "react";
import { analysisProgressText } from "../../shared/lib/analysisDisplay";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, CheckCircle2, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { useAnalysisRun, useStartAnalysis } from "../../shared/api/analysis";
import { queries } from "../../shared/api/queries";
import { ApiRequestError, useAdminAccess } from "../../shared/api/adminAccess";

const analysisLabels: Record<string, string> = {
  "OHLCV 수집·앙상블 예측": "종목 가격 수집·모델 예측",
  "KOSPI200 후보 풀 로드": "코스피200 분석 대상 불러오기",
  "모델·수급 결과 확인": "모델 분석 결과 확인",
  "AI 요약 생성": "AI 요약 생성",
  "파이프라인 파일과 실행 환경을 확인하는 중입니다.": "분석에 필요한 자료와 실행 환경을 확인하고 있습니다.",
  "integrated_pipeline.py 실행을 시작했습니다.": "종목 분석을 시작했습니다.",
  "파이프라인 실행 로그": "분석 실행 기록",
  "서버 로그": "분석 실행 기록",
};
function displayAnalysisText(value: unknown, fallback?: string) {
  const mapped = typeof value === "string" ? Object.entries(analysisLabels).reduce((text, [raw, label]) => text.split(raw).join(label), value) : value;
  return analysisProgressText(mapped, fallback);
}

/** onRequestStart moves focus before the start button becomes disabled. */
export function AnalysisControl({ onShowTopFive, onRequestStart, labelledBy }: { onShowTopFive?: () => void; onRequestStart?: () => void; labelledBy?: string } = {}) {
  const admin = useAdminAccess();
  const paths = useAppPaths(), location = useLocation(), backend = useQuery(queries.backendStatus());
  const analysis = useAnalysisRun(), start = useStartAnalysis();
  const [checking, setChecking] = useState(false), [requestError, setRequestError] = useState<{ message: string; status?: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const adminParams = new URLSearchParams(location.search); adminParams.set("admin", "");
  const submitting = useRef(false), run = analysis.data?.data;
  const running = run?.status === "running" || backend.data?.runtime.state === "running";
  const busy = checking || start.isPending || running;
  const completed = !running && run?.status === "completed";
  const uncertain = backend.isError || analysis.isError || !backend.data || !run;
  const progress = run?.progress?.progressPercent;
  const percent = typeof progress === "number" && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined;
  const message = displayAnalysisText(run?.progress?.message);
  const stageIndex = run?.progress?.stageIndex, stageCount = run?.progress?.stageCount;
  const stageLabel = displayAnalysisText(run?.progress?.stage, "");
  const stagePosition = typeof stageIndex === "number" && Number.isInteger(stageIndex) && stageIndex >= 0 && typeof stageCount === "number" && Number.isInteger(stageCount) && stageCount > stageIndex
    ? `${stageIndex + 1}/${stageCount}단계` : null;
  const elapsed = run?.elapsedMs;
  const elapsedLabel = typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
    ? Math.floor(elapsed / 60000) + "분 " + Math.floor(elapsed % 60000 / 1000) + "초 경과" : null;
  const stageSuffix = stageLabel && message.startsWith(stageLabel) ? message.slice(stageLabel.length) : null;
  const messageDetails = stageSuffix !== null && /^(?:\s|·|$)/.test(stageSuffix) ? stageSuffix.replace(/^\s*중(?=\s|$)/, "").replace(/^\s*·\s*/, "").trim() : message;
  const progressDetails = [analysis.isError ? "진행 상태 갱신 실패 · 마지막 확인 상태는 분석 진행 중입니다." : messageDetails, elapsedLabel].filter(Boolean).join(" · ");

  async function launch() {
    if (!admin || submitting.current || busy || uncertain) return;
    if (onRequestStart) onRequestStart(); else heading.current?.focus();
    submitting.current = true; setChecking(true); setRequestError(null);
    try {
      const [configuration, status] = await Promise.all([backend.refetch(), analysis.refetch()]);
      if (configuration.isError || status.isError || !configuration.data || !status.data) {
        setRequestError({ message: "실행 설정과 상태를 확인하지 못했습니다. 상태를 다시 확인해 주세요." }); return;
      }
      if (configuration.data.runtime.state === "running" || status.data.data.status === "running") return;
      await start.mutateAsync({ mode: "model_only", kind: "adhoc" });
    } catch (error) {
      setRequestError(error instanceof ApiRequestError ? { message: error.message, status: error.status } : { message: "실행 요청을 확인하지 못했습니다. 서버에서 시작됐을 수 있으니 상태를 다시 확인해 주세요." });
      await Promise.all([backend.refetch(), analysis.refetch()]);
    } finally { submitting.current = false; setChecking(false); }
  }
  async function recheck() { setRequestError(null); await Promise.all([backend.refetch(), analysis.refetch()]); }

  if (!admin) return <p className="briefing-muted">새 분석은 장 마감 후 자동으로 생성됩니다.</p>;
  return <section className="briefing-card analysis-control" aria-labelledby={labelledBy ?? "analysis-control-heading"}>
    <div className="analysis-control-main">
      <div className="analysis-control-copy">
        {!labelledBy && <><p className="briefing-eyebrow">분석 실행</p><h2 id="analysis-control-heading" ref={heading} tabIndex={-1}>새 분석 실행</h2></>}
        <p id="analysis-mode-description" className="analysis-control-description">모델 순위를 계산한 뒤 TOP5의 관련 기사를 수집하고 AI 요약을 생성합니다.</p>
        <p className="analysis-control-caption">최근 실행은 약 40초가 걸렸으며 상황에 따라 더 걸릴 수 있습니다. 실행 중에도 현재 결과는 그대로 보입니다.</p>
        <p className="analysis-control-caption">관리자 실행은 수시 기록입니다. 공식 기록은 장 마감 후 예약 작업에서 생성합니다.</p>
      </div>
      <button type="button" className={`briefing-button analysis-start-button${completed && onShowTopFive ? " analysis-start-secondary" : ""}`} onClick={() => void launch()}
        disabled={busy || uncertain} aria-describedby="analysis-mode-description" aria-busy={busy}>
        {busy ? <LoaderCircle className="analysis-spinner" aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        {running ? "분석 진행 중" : checking || start.isPending ? "실행 요청 중" : "분석 시작"}
      </button>
    </div>
    <div className="analysis-control-status" role="status" aria-live="polite" aria-atomic="true">
      {running ? <>{(stageLabel || stagePosition) && <p>{[stageLabel, stagePosition].filter(Boolean).join(" · ")}</p>}
        {progressDetails && <p className="analysis-control-caption">{progressDetails}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}><progress aria-label="분석 진행률" max={100} value={percent} style={{ flex: 1, marginTop: 0 }} /><span>{percent === undefined ? "진행률 확인 중" : `${Math.round(percent)}%`}</span></div>
        <p className="analysis-control-caption">분석 진행 상태를 5초마다 확인합니다.</p></>
        : completed ? <div className="analysis-complete"><p><CheckCircle2 aria-hidden="true" size={16} />분석 완료 · 모델 TOP5가 준비됐습니다.</p>
          {onShowTopFive && <button type="button" className="briefing-button analysis-show-top-five" onClick={onShowTopFive}>TOP5 보러가기<ArrowRight aria-hidden="true" size={18} /></button>}</div>
        : run?.status === "failed" ? <p className="analysis-control-error">분석 실패 · {displayAnalysisText(run.error, "분석 실행 기록을 확인한 뒤 다시 시도해 주세요.")}</p>
        : <p>새 분석은 서버에서 실행됩니다. ‘다시 조회’는 저장된 결과만 불러옵니다.</p>}
      {requestError && <p className="analysis-control-error">{requestError.message}{requestError.status === 401 && <> <Link to={{ pathname: location.pathname, search: `?${adminParams}`, hash: location.hash }}>관리자 인증하기<ArrowRight aria-hidden="true" size={14} /></Link></>}</p>}
      {analysis.isError && !running && <p className="analysis-control-error">분석 실행 상태 조회 실패 · 상태를 다시 확인해 주세요.</p>}
    </div>
    <div className="analysis-control-links">
      <Link to={paths.history}>분석 기록 보기<ArrowRight aria-hidden="true" size={14} /></Link>
      <Link to={paths.rank}>전체 순위 보기<ArrowRight aria-hidden="true" size={14} /></Link>
      {(uncertain || requestError || run?.status === "failed") && <button type="button" onClick={() => void recheck()} disabled={backend.isFetching || analysis.isFetching || busy}>
        <RefreshCw aria-hidden="true" size={14} />실행 상태 다시 확인</button>}
    </div>
    {run?.runId && <details className="analysis-control-caption"><summary>실행 정보</summary><p>{run.kind === "official" ? "공식 예약 실행" : "관리자 수시 실행"} · 실행 식별자 {run.runId}</p></details>}
  </section>;
}
