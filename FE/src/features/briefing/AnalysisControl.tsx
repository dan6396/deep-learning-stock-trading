import { useRef, useState } from "react";
import { analysisProgressText } from "../../shared/lib/analysisDisplay";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { useAnalysisRun, useStartAnalysis } from "../../shared/api/analysis";
import { queries } from "../../shared/api/queries";
import type { RunKind } from "../../types/performance";

/** onShowTopFive: when provided, a completed run offers a primary shortcut to the briefing TOP5. */
export function AnalysisControl({ onShowTopFive }: { onShowTopFive?: () => void } = {}) {
  const paths = useAppPaths(), backend = useQuery(queries.backendStatus());
  const analysis = useAnalysisRun(), start = useStartAnalysis();
  const [checking, setChecking] = useState(false), [requestError, setRequestError] = useState<string | null>(null);
  const [kind, setKind] = useState<RunKind>("adhoc");
  const submitting = useRef(false), run = analysis.data?.data;
  const running = run?.status === "running" || backend.data?.runtime.state === "running";
  const busy = checking || start.isPending || running;
  const completed = !running && run?.status === "completed";
  const uncertain = backend.isError || analysis.isError || !backend.data || !run;
  const progress = run?.progress?.progressPercent;
  const percent = typeof progress === "number" && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined;
  const message = analysisProgressText(run?.progress?.message);
  const elapsed = run?.elapsedMs;
  const elapsedLabel = typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
    ? Math.floor(elapsed / 60000) + "분 " + Math.floor(elapsed % 60000 / 1000) + "초 경과" : null;

  async function launch() {
    if (submitting.current || busy || uncertain) return;
    submitting.current = true; setChecking(true); setRequestError(null);
    try {
      const [configuration, status] = await Promise.all([backend.refetch(), analysis.refetch()]);
      if (configuration.isError || status.isError || !configuration.data || !status.data) {
        setRequestError("실행 설정과 상태를 확인하지 못했습니다. 상태를 다시 확인해 주세요."); return;
      }
      if (configuration.data.runtime.state === "running" || status.data.data.status === "running") return;
      await start.mutateAsync({ mode: "model_only", kind });
    } catch {
      setRequestError("실행 요청을 확인하지 못했습니다. 서버에서 시작됐을 수 있으니 상태를 다시 확인해 주세요.");
      await Promise.all([backend.refetch(), analysis.refetch()]);
    } finally { submitting.current = false; setChecking(false); }
  }
  async function recheck() { setRequestError(null); await Promise.all([backend.refetch(), analysis.refetch()]); }

  return <section className="briefing-card analysis-control" aria-labelledby="analysis-control-heading">
    <div className="analysis-control-main">
      <div className="analysis-control-copy">
        <p className="briefing-eyebrow">분석 실행</p>
        <h2 id="analysis-control-heading">새 분석 실행</h2>
        <p id="analysis-mode-description" className="analysis-control-description">모델 순위를 계산한 뒤 TOP5의 관련 기사를 수집합니다.</p>
        <p className="analysis-control-caption">최근 실행은 약 40초가 걸렸으며 상황에 따라 더 걸릴 수 있습니다. 실행 중에도 현재 결과는 그대로 보입니다.</p>
        <label className="analysis-official-choice"><input type="checkbox" checked={(running ? run?.kind : kind) === "official"} disabled={busy || !backend.data} onChange={event => setKind(event.target.checked ? "official" : "adhoc")} />공식 성과 기록 요청</label>
        <p className="analysis-control-caption">기본은 수시 실행입니다. 공식 요청은 기준일별 첫 완료 예측을 고정하고, 목표일 09:00 한국시간 전 완료 여부를 검증합니다.</p>
      </div>
      <button type="button" className={`briefing-button analysis-start-button${completed && onShowTopFive ? " analysis-start-secondary" : ""}`} onClick={() => void launch()}
        disabled={busy || uncertain} aria-describedby="analysis-mode-description" aria-busy={busy}>
        {busy ? <LoaderCircle className="analysis-spinner" aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        {running ? "분석 진행 중" : checking || start.isPending ? "실행 요청 중" : "분석 시작"}
      </button>
    </div>
    <div className="analysis-control-status" role="status" aria-live="polite" aria-atomic="true">
      {run?.runId && <p className="analysis-control-caption">{run.kind === "official" ? "공식 기록 요청" : "수시 실행"} · 실행 식별자 {run.runId}</p>}
      {running ? <><p>{analysis.isError ? "진행 상태 갱신 실패 · 마지막 확인 상태는 분석 진행 중입니다." : message}{elapsedLabel ? " · " + elapsedLabel : ""}</p>
        <progress aria-label="분석 진행률" max={100} value={percent} /><p className="analysis-control-caption">서버가 제공한 단계별 진행 상태 · 진행 중에는 5초마다 확인합니다.</p></>
        : completed ? <div className="analysis-complete"><p><CheckCircle2 aria-hidden="true" size={16} />분석 완료 · 모델 TOP5가 준비됐습니다.</p>
          {onShowTopFive && <button type="button" className="briefing-button analysis-show-top-five" onClick={onShowTopFive}>TOP5 보러가기<ArrowRight aria-hidden="true" size={18} /></button>}</div>
        : run?.status === "failed" ? <p className="analysis-control-error">분석 실패 · {analysisProgressText(run.error, "분석 기록과 서버 로그를 확인해 주세요.")}</p>
        : <p>새 분석은 서버에서 실행됩니다. ‘다시 조회’는 저장된 결과만 불러옵니다.</p>}
      {requestError && <p className="analysis-control-error">{requestError}</p>}
      {analysis.isError && !running && <p className="analysis-control-error">분석 실행 상태 조회 실패 · 상태를 다시 확인해 주세요.</p>}
    </div>
    <div className="analysis-control-links">
      <Link to={paths.history}>분석 기록 보기<ArrowRight aria-hidden="true" size={14} /></Link>
      <Link to={paths.rank}>전체 순위 보기<ArrowRight aria-hidden="true" size={14} /></Link>
      {(uncertain || requestError || run?.status === "failed") && <button type="button" onClick={() => void recheck()} disabled={backend.isFetching || analysis.isFetching || busy}>
        <RefreshCw aria-hidden="true" size={14} />실행 상태 다시 확인</button>}
    </div>
  </section>;
}
