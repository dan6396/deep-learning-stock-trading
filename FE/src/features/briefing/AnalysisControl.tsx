import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { useAnalysisRun, useStartAnalysis, type AnalysisMode } from "../../shared/api/analysis";
import { queries } from "../../shared/api/queries";
import type { RunKind } from "../../types/performance";

export function AnalysisControl() {
  const paths = useAppPaths(), backend = useQuery(queries.backendStatus());
  const analysis = useAnalysisRun(), start = useStartAnalysis();
  const [checking, setChecking] = useState(false), [requestError, setRequestError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<AnalysisMode | null>(null);
  const [kind, setKind] = useState<RunKind>("adhoc");
  const submitting = useRef(false);
  const run = analysis.data?.data;
  const mode = (run?.status === "running" ? run.mode : undefined) ?? selectedMode ?? backend.data?.analysisMode;
  const newsReady = backend.data?.news.configuration === "configured" && backend.data?.news.collectionConfiguration === "configured";
  const missingNews = mode === "full" && !newsReady;
  const running = run?.status === "running" || backend.data?.runtime.state === "running";
  const busy = checking || start.isPending || running;
  const uncertain = backend.isError || analysis.isError || !backend.data || !run || mode === "unknown";
  const progress = run?.progress?.progressPercent;
  const percent = typeof progress === "number" && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined;
  const message = typeof run?.progress?.message === "string" ? run.progress.message : "서버에서 분석을 진행하고 있습니다.";
  const elapsed = run?.elapsedMs;
  const elapsedLabel = typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
    ? `${Math.floor(elapsed / 60000)}분 ${Math.floor(elapsed % 60000 / 1000)}초 경과` : null;

  async function launch() {
    if (submitting.current || busy || uncertain || missingNews || (mode !== "model_only" && mode !== "full")) return;
    submitting.current = true;
    setSelectedMode(mode);
    setChecking(true);
    setRequestError(null);
    try {
      // Recheck configuration and runtime before a paid or long-running action.
      const [configuration, status] = await Promise.all([backend.refetch(), analysis.refetch()]);
      if (configuration.isError || status.isError || !configuration.data || !status.data) {
        setRequestError("실행 설정과 상태를 확인하지 못했습니다. 상태를 다시 확인해 주세요.");
        return;
      }
      if (configuration.data.runtime.state === "running" || status.data.data.status === "running") return;
      if (mode === "full" && (configuration.data.news.configuration !== "configured" || configuration.data.news.collectionConfiguration !== "configured")) {
        setRequestError("뉴스 포함 분석에는 네이버 뉴스와 Gemini API 설정이 필요합니다.");
        return;
      }
      await start.mutateAsync({ mode, kind });
    } catch {
      setRequestError("실행 요청을 확인하지 못했습니다. 서버에서 시작됐을 수 있으니 상태를 다시 확인해 주세요.");
      await Promise.all([backend.refetch(), analysis.refetch()]);
    } finally {
      submitting.current = false;
      setChecking(false);
    }
  }

  async function recheck() {
    setRequestError(null);
    await Promise.all([backend.refetch(), analysis.refetch()]);
  }

  return <section className="briefing-card analysis-control" aria-labelledby="analysis-control-heading">
    <div className="analysis-control-main">
      <div className="analysis-control-copy">
        <p className="briefing-eyebrow">NEW ANALYSIS</p>
        <h2 id="analysis-control-heading">새 분석 실행</h2>
        <p className="analysis-control-caption">이번 실행에 사용할 모드를 선택하세요. 서버 기본 설정은 변경되지 않습니다.</p>
        <fieldset className="analysis-mode-picker" disabled={busy || !backend.data || backend.isError} aria-describedby="analysis-mode-description">
          <legend>분석 모드</legend>
          <div className="analysis-mode-options">
            <label className={`analysis-mode-option${mode === "model_only" ? " is-selected" : ""}`}>
              <input type="radio" name="analysis-mode" value="model_only" checked={mode === "model_only"} onChange={() => { setSelectedMode("model_only"); setRequestError(null); }} />
              <span><strong>모델 예측만</strong><small>예측 순위 · 뉴스 API 호출 없음</small></span>
            </label>
            <label className={`analysis-mode-option${mode === "full" ? " is-selected" : ""}`}>
              <input type="radio" name="analysis-mode" value="full" checked={mode === "full"} onChange={() => { setSelectedMode("full"); setRequestError(null); }} />
              <span><strong>뉴스 포함</strong><small>뉴스 수집 + Gemini 분석 · 유료 API</small></span>
            </label>
          </div>
        </fieldset>
        <label className="analysis-official-choice"><input type="checkbox" checked={(running ? run?.kind : kind) === "official"} disabled={busy || !backend.data} onChange={event => setKind(event.target.checked ? "official" : "adhoc")} />공식 성과 기록 요청</label>
        <p className="analysis-control-caption">기본은 수시 실행입니다. 공식 요청은 기준일·모드별 첫 완료 예측을 고정하고, 목표일 09:00 한국시간 전 완료 여부를 검증합니다.</p>
        <p id="analysis-mode-description" className="analysis-control-description">
          {backend.isError || !backend.data ? "실행 모드를 확인하고 있습니다. 상태를 다시 확인해 주세요."
            : mode === "model_only" ? "모델 전용 · 뉴스 호출 없이 예측 순위를 계산합니다. 최종 후보는 생성하지 않습니다."
            : mode === "full" ? "뉴스 포함 · 모델 예측과 뉴스 분석을 실행합니다. Gemini 유료 API 호출이 포함됩니다."
            : "실행 모드 미확인 · 서버의 분석 모드 설정을 확인해 주세요."}
        </p>
        {missingNews && <p className="analysis-control-error" role="status">뉴스 포함 분석에는 네이버 뉴스와 Gemini API 설정이 필요합니다. 모델 예측만 실행할 수 있습니다.</p>}
      </div>
      <button type="button" className="briefing-button analysis-start-button" onClick={() => void launch()}
        disabled={busy || uncertain || missingNews} aria-describedby="analysis-mode-description" aria-busy={busy}>
        {busy ? <LoaderCircle className="analysis-spinner" aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        {running ? "분석 진행 중" : checking || start.isPending ? "실행 요청 중" : "분석 시작"}
      </button>
    </div>
    <div className="analysis-control-status" role="status" aria-live="polite" aria-atomic="true">
      {run?.runId && <p className="analysis-control-caption">{run.kind === "official" ? "공식 기록 요청" : "수시 실행"} · 실행 식별자 {run.runId}</p>}
      {running ? <><p>{analysis.isError ? "진행 상태 갱신 실패 · 마지막 확인 상태는 분석 진행 중입니다." : message}{elapsedLabel ? ` · ${elapsedLabel}` : ""}</p>
        <progress aria-label="분석 진행률" max={100} value={percent} /><p className="analysis-control-caption">서버가 제공한 단계별 진행 상태 · 진행 중에는 5초마다 확인합니다.</p></>
        : run?.status === "completed" ? <p>{run.result?.mode === "model_only"
          ? "모델 분석 완료 · 전체 순위에서 결과를 확인하세요. 뉴스 보정 최종 후보는 생성되지 않았습니다."
          : "최근 분석 완료 · 저장된 결과를 갱신했습니다."}</p>
        : run?.status === "failed" ? <p className="analysis-control-error">분석 실패 · {run.error || "분석 기록과 서버 로그를 확인해 주세요."}</p>
        : <p>새 분석은 서버에서 실행됩니다. ‘다시 조회’는 저장된 결과만 불러옵니다.</p>}
      {requestError && <p className="analysis-control-error">{requestError}</p>}
      {analysis.isError && !running && <p className="analysis-control-error">분석 실행 상태 조회 실패 · 상태를 다시 확인해 주세요.</p>}
    </div>
    <div className="analysis-control-links">
      <Link to={paths.history}>분석 기록 보기<ArrowRight aria-hidden="true" size={14} /></Link>
      {(mode === "model_only" || run?.result?.mode === "model_only") && <Link to={paths.rank}>전체 순위 보기<ArrowRight aria-hidden="true" size={14} /></Link>}
      {(uncertain || requestError || run?.status === "failed") && <button type="button" onClick={() => void recheck()} disabled={backend.isFetching || analysis.isFetching || busy}>
        <RefreshCw aria-hidden="true" size={14} />실행 상태 다시 확인</button>}
    </div>
  </section>;
}
