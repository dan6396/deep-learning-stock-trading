import { Star } from "lucide-react";
import { useWatchlist } from "../../shared/lib/watchlist";
import "./watchlist.css";

export function WatchToggle({ code, name, showLabel = false }: { code: string; name?: string | null; showLabel?: boolean }) {
  const watchlist = useWatchlist(), selected = watchlist.codes.includes(code);
  return <button type="button" className="watch-toggle" data-watch-code={code} aria-pressed={selected} aria-label={`${name && name !== code ? `${name} ` : ""}${code} ${showLabel ? selected ? "관심 해제" : "관심 추가" : "관심 종목"}`} title={`관심 종목 ${selected ? "해제" : "추가"}`} onClick={() => watchlist.toggle(code)}>
    <Star aria-hidden="true" size={17} fill={selected ? "currentColor" : "none"} /><span className={showLabel ? undefined : "watch-sr-only"}>{showLabel ? selected ? "관심 해제" : "관심 추가" : "관심 종목"}</span>
  </button>;
}
export function WatchlistNotice() {
  const { sessionOnly } = useWatchlist();
  return sessionOnly ? <p className="watch-notice" role="status">관심 종목을 이 기기에 저장하지 못했습니다. 현재 탭에서만 유지되며, 새로고침하면 사라질 수 있습니다.</p> : null;
}
