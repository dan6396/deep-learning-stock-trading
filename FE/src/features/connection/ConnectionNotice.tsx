import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable, ChevronDown, RotateCw } from "lucide-react";
import { queries } from "../../shared/api/queries";
import { formatDate } from "../../shared/lib/format";
import type { BackendStatus, PipelineAvailability } from "../../types/backendStatus";
import "./connection.css";

export function availabilityMessage(label: string, result: PipelineAvailability): string {
  switch (result.state) {
    case "available": return `${label}: 저장된 분석 결과 제공`;
    case "empty": return `${label}: 정상 완료된 분석 결과 0건`;
    case "not_produced": return `${label}: 뉴스 보정 최종 후보 미생성`;
    case "sample": return `${label}: 예시 자료 · 실제 분석 미확인`;
    case "stale": return `${label}: 이전 분석 파일 · 현재 결과로 사용 불가`;
    case "invalid": return `${label}: 저장 결과 확인 필요`;
    case "unknown": return `${label}: 결과 상태 미확인`;
    default: return `${label}: 분석 결과 생성 대기`;
  }
}
export function analysisMessage(status: BackendStatus): string {
  if (status.runtime.state === "running") return "분석 진행 중";
  if (status.runtime.state === "failed") return "최근 분석 실패";
  if (status.marker.state === "failed") return "최근 저장된 분석 실패 · 현재 실행 중인 분석 없음";
  if (status.runtime.state === "unknown") return "현재 분석 실행 상태 미확인";
  if (status.marker.state === "running") return "이전 실행 기록은 진행 중 · 현재 실행 재확인 필요";
  if (status.marker.state === "completed") return status.marker.mode === "model_only" ? "모델 분석 완료 · 뉴스 분석 미실행" : "저장된 분석 완료 기록";
  return "분석 결과 생성 대기";
}
export function ConnectionNotice() {
  const query = useQuery(queries.backendStatus()), status = query.data;
  const storedResults = status?.results.rank.state === "available" && (status.results.candidates.state === "available" || status.results.candidates.state === "empty"
    || (status.analysisMode === "model_only" && status.results.candidates.state === "not_produced"));
  const needsAttention = query.isError || Boolean(status && (
    status.runtime.state === "failed" || status.runtime.state === "unknown" || status.marker.state === "failed" || status.marker.state === "invalid"
    || status.analysisMode === "unknown" || (!storedResults && status.runtime.state !== "running")
    || [status.results.rank.state, status.results.candidates.state].some(state => ["stale", "invalid", "blocked"].includes(state))));
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(needsAttention); }, [needsAttention]);
  return <aside className="connection-notice" aria-label="데이터 연결 상태" data-connection-state={query.isError ? "error" : query.isPending ? "pending" : "ready"}>
    <details className="connection-disclosure" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="connection-notice-heading"><Cable size={17} aria-hidden="true" /><strong>데이터 연결 상태</strong>
        <span className={needsAttention ? "connection-attention" : ""}>{needsAttention ? "확인 필요" : !status ? "확인 중" : status.runtime.state === "running" ? "분석 진행 중" : `모델 결과 저장됨 · 저장 시각 ${formatDate(status.results.rank.asOf, true)}`}</span><ChevronDown className="connection-chevron" size={16} aria-hidden="true" /></summary>
      <div className="connection-notice-body">
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}><RotateCw size={15} aria-hidden="true" />연결 상태 다시 확인</button>
    {query.isError && <p role="status">{status ? "이전 확인 결과 · 연결 상태 갱신 실패" : "연결 상태 미확인 · 다른 화면은 계속 이용할 수 있습니다."}</p>}
    {!status ? !query.isError && <p>연결 상태 확인 중</p> : <>
      <p>{status.market.configuration === "configured" ? "시장 데이터 설정 확인 · 조회 검증 필요" : "시장 데이터 연결 대기"}</p>
      <p>{analysisMessage(status)}</p>
      <div className="connection-notice-results"><span>{availabilityMessage("전체 순위", status.results.rank)}</span><span>{availabilityMessage("최종 후보", status.results.candidates)}</span></div>
      <div className="connection-explanation"><p>이 상태 API는 키 설정 유무만 확인하며 외부 API에 접속하지 않습니다. KIS 조회 성공 여부는 여기 저장되지 않습니다. 가격·지수의 실제 출처와 기준 시각은 각 화면에서 확인하세요.</p>
        <p>{status.analysisMode === "model_only" ? "서버 기본값: 모델 전용. 새 분석 실행에서 뉴스 포함 모드를 선택할 수 있습니다." : status.analysisMode === "unknown" ? "분석 실행 설정 미확인" : "서버 기본값: 뉴스 포함. 새 분석 실행에서 모드를 선택하세요. Gemini 유료 API가 포함됩니다."}</p>
        <p>{status.news.configuration === "configured" ? "뉴스 평가 설정 확인" : "뉴스 평가 연결 대기"} · {status.news.collectionConfiguration === "configured" ? "기사 수집 설정 확인" : "기사 수집 연결 대기"}. 설정 여부만 확인했으며 수집·평가는 검증하지 않았습니다.</p>
        <p>상태 확인 시각 {formatDate(status.checkedAt, true)} · 분석 자료는 저장 결과이며 실시간 가격이 아닙니다.</p>
      </div>
    </>}
      </div>
    </details>
  </aside>;
}
