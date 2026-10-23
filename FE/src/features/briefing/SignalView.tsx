import { Triangle, Circle, CircleHelp } from "lucide-react";
import type { Signal, SignalState } from "../../entities/signals";

const labels: Record<SignalState, string> = { positive: "긍정", neutral: "중립", negative: "부정", unavailable: "판정 불가" };
const modelLabels: Record<SignalState, string> = { positive: "모델 상위권", neutral: "모델 중위권", negative: "모델 하위권", unavailable: "순위 미확인" };
export function SignalView({ signal, model = false }: { signal: Signal; model?: boolean }) {
  const Icon = signal.state === "unavailable" ? CircleHelp : model ? Circle : signal.state === "positive" || signal.state === "negative" ? Triangle : Circle;
  return <span className="briefing-signal" data-signal={model ? "neutral" : signal.state} title={signal.reason}>
    <Icon aria-hidden="true" size={14} /><span>{(model ? modelLabels : labels)[signal.state]}</span>
  </span>;
}
