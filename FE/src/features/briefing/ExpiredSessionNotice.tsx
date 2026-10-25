import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { useNextSession } from "./ModelTopFiveTable";
import { useAppPaths } from "../../app/paths";

/** The session date comes from the existing KIS/KRX calendar endpoint, never weekday arithmetic. */
export function targetSessionEnd(session: string | null | undefined): number | null {
  if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(session)) return null;
  const end = Date.parse(`${session}T15:30:00+09:00`);
  return Number.isFinite(end) && new Date(end).toISOString().slice(0, 10) === session ? end : null;
}

export function ExpiredSessionNotice({ baseDate }: { baseDate?: string | null }) {
  const { data: target } = useNextSession(baseDate), paths = useAppPaths();
  const [clock, setClock] = useState(Date.now), end = targetSessionEnd(target);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const current = Date.now(); setClock(current);
      if (end !== null && end > current) timer = setTimeout(update, Math.min(end - current, 2_147_483_647));
    };
    update();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [end]);
  if (end === null || clock < end) return null;
  const date = `${Number(target!.slice(5, 7))}/${Number(target!.slice(8, 10))}`;
  return <aside className="briefing-session-notice" aria-label="예측 대상 세션 안내" role="note">
    <Info size={16} aria-hidden="true" />
    <p>이 순위의 예측 대상({date} 정규장)은 종료되었습니다. 다음 거래일 순위는 새 분석 후 표시됩니다. <Link to={`${paths.about}#analysis-guide`}>분석 실행 안내</Link></p>
  </aside>;
}
