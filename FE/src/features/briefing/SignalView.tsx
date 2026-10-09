import { Triangle, Circle, CircleHelp } from "lucide-react";
import type { Signal, SignalState } from "../../entities/signals";

const labels: Record<SignalState, string> = { positive: "긍정", neutral: "중립", negative: "부정", unavailable: "판정 불가" };
export function SignalView({ signal }: { signal: Signal }) {
  const Icon = signal.state === "unavailable" ? CircleHelp : signal.state === "positive" || signal.state === "negative" ? Triangle : Circle;
  return <span className="briefing-signal" data-signal={signal.state} title={signal.reason}>
    <Icon aria-hidden="true" size={14} /><span>{labels[signal.state]}</span>
  </span>;
}
