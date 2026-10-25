import { useEffect, useState } from "react";
import { pastObservation } from "../../types/observationAge";
import { formatDate } from "../../shared/lib/format";
import "./pastObservation.css";
export function PastObservationTag({ asOf }: { asOf: string | null | undefined }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (!asOf) return; const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, [asOf]);
  return pastObservation(asOf, clock) ? <span className="past-observation-tag">지난 관측 · 기준 시각 {formatDate(asOf, true)}</span> : null;
}
