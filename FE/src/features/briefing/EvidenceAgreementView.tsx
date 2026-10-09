import type { briefingSignals } from "./membership";

export function EvidenceAgreementView({ signals, modelOnly }: { signals: ReturnType<typeof briefingSignals>; modelOnly: boolean }) {
  const keys = modelOnly ? ["model", "supply"] as const : ["model", "news", "supply"] as const;
  return <span className="briefing-evidence-agreement"><span className="briefing-evidence-dots" aria-hidden="true">{keys.map(key => <i key={key} data-evidence-state={signals[key].state} />)}</span><span>{signals.agreement.positive}/{keys.length} 긍정</span>{signals.agreement.unavailable > 0 && <small>판정 불가 {signals.agreement.unavailable}</small>}</span>;
}
