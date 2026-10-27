import { useEffect, useState } from "react";
import { useNextSession } from "./ModelTopFiveTable";

/** The session date comes from the existing KIS/KRX calendar endpoint, never weekday arithmetic. */
export function targetSessionEnd(session: string | null | undefined): number | null {
  if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(session)) return null;
  const end = Date.parse(`${session}T15:30:00+09:00`);
  return Number.isFinite(end) && new Date(end).toISOString().slice(0, 10) === session ? end : null;
}

export function useTargetSession(baseDate?: string | null) {
  const { data: target } = useNextSession(baseDate);
  const end = targetSessionEnd(target);
  const [isSessionEnded, setIsSessionEnded] = useState(() => {
    return end !== null && Date.now() >= end;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const current = Date.now();
      const ended = end !== null && current >= end;
      setIsSessionEnded(ended);
      if (end !== null && end > current) {
        timer = setTimeout(update, Math.min(end - current, 2_147_483_647));
      }
    };
    update();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [end]);

  return { target, isSessionEnded };
}
