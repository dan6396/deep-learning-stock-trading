import { CircleHelp } from "lucide-react";
import type { Signal, SignalState } from "../../entities/signals";

const labels: Record<SignalState, string> = { positive: "긍정 기사 우세", neutral: "기사 판정 중립", negative: "부정 기사 우세", unavailable: "뉴스 판정 자료 없음" };
const modelLabels: Record<SignalState, string> = { positive: "모델 상위권", neutral: "모델 중위권", negative: "모델 하위권", unavailable: "순위 미확인" };
export function SignalView({ signal, model = signal.modelLabel !== undefined }: { signal: Signal; model?: boolean }) {
  const label = model ? signal.modelLabel ?? modelLabels[signal.state]
    : /모델 전용|뉴스 미사용/.test(signal.reason) ? "뉴스 보정 미실행" : labels[signal.state];
  return <span className="briefing-signal" data-signal={signal.state === "unavailable" ? "unavailable" : "neutral"} title={signal.reason}>
    {signal.state === "unavailable" && <CircleHelp aria-hidden="true" size={14} />}<span>{label}</span>
  </span>;
}
