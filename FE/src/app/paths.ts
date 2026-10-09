import { useLocation } from "react-router-dom";

/** Keep the rebuilt preview aliases navigable without leaking them into root links. */
export function useAppPaths() {
  const { pathname } = useLocation();
  const base = pathname === "/next" || pathname.startsWith("/next/") ? "/next" : "";
  return {
    briefing: base || "/",
    rank: `${base}/rank`,
    watchlist: `${base}/watchlist`,
    history: `${base}/history`,
    about: `${base}/about`,
    stock: (code: string) => `${base}/stock/${code}`,
  };
}
