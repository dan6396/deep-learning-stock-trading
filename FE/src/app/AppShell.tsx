import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { BRAND_NAME, BrandMark } from "../shared/lib/brand";
import { useTheme } from "./providers";
import { useAppPaths } from "./paths";
import { SearchDialog } from "../features/search/SearchDialog";
import { ConnectionNotice } from "../features/connection/ConnectionNotice";
import { AnalysisDialog } from "../features/briefing/AnalysisDialog";
import { setAdminToken, useAdminAccess, useLocalWriteAllowed, useStoredAdminToken } from "../shared/api/adminAccess";
import "./adminDialog.css";

export const NEXT_BASE = "/next";

function AdminTokenDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState(""), [error, setError] = useState("");
  const storedToken = useStoredAdminToken(), local = useLocalWriteAllowed();
  useEffect(() => {
    const node = dialog.current;
    if (node?.showModal) node.showModal(); else node?.setAttribute("open", "");
    input.current?.focus();
    return () => { if (node?.open) node.close?.(); };
  }, []);
  function save(value: string) {
    try { setAdminToken(value); setToken(""); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
  }
  return <dialog ref={dialog} className="ds-root admin-token-dialog" aria-labelledby="admin-title" aria-describedby="admin-description" onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (token.trim()) save(token); }}>
      <h2 id="admin-title">관리자 모드</h2><p id="admin-description">토큰은 현재 탭의 세션 저장소에만 저장합니다. 인증은 실행 요청 때 확인합니다.</p>
      {local && <p>로컬 개발 모드 · 토큰 없이 실행할 수 있습니다.</p>}
      <div className="admin-token-field">
        <label htmlFor="admin-token">관리자 API 토큰</label>
        <input ref={input} id="admin-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="admin-token-actions">
        <button type="submit" className="admin-token-save" disabled={!token.trim()}>저장</button>
        <button type="button" disabled={!storedToken} onClick={() => save("")}>해제</button>
        <button type="button" onClick={close}>닫기</button>
      </div>
    </form>
  </dialog>;
}

export function AppShell() {
  const admin = useAdminAccess();
  const { theme, toggleTheme } = useTheme();
  const { pathname, search, hash } = useLocation(), navigate = useNavigate();
  const showAdmin = new URLSearchParams(search).has("admin");
  function closeAdmin() {
    const params = new URLSearchParams(search); params.delete("admin");
    navigate({ pathname, search: params.size ? `?${params}` : "", hash }, { replace: true });
  }
  const paths = useAppPaths();
  const tabs = [
    { to: paths.briefing, label: "브리핑", end: true },
    { to: paths.rank, label: "전체 순위", end: false },
    { to: paths.watchlist, label: "관심", end: false },
    { to: paths.history, label: "분석 기록", end: false },
  ];
  return <div className="ds-root min-h-dvh bg-bg font-sans text-fg antialiased">
    {showAdmin && <AdminTokenDialog close={closeAdmin} />}
    <header className="ds-header sticky top-0 z-10 bg-surface">
      <NavLink to={paths.briefing} className="ds-brand"><BrandMark className="size-7 text-fg" /><span>{BRAND_NAME}</span></NavLink>
      <nav aria-label="주요 메뉴" className="ds-nav">
        {tabs.map(tab => <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `ds-nav-link${isActive ? " ds-nav-active" : ""}`}>{tab.label}</NavLink>)}
      </nav>
      <div className="ds-header-actions">
        <SearchDialog />
        <ConnectionNotice />
        <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"} className="ds-theme-button">
          {theme === "dark" ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
        </button>
        {admin && import.meta.env.VITE_DEMO_HIDE_RUN !== "1" && <AnalysisDialog />}
      </div>
    </header>
    <main id="main-content" data-route-path={pathname} tabIndex={-1} className={`ds-main${pathname === paths.briefing ? " ds-main-briefing" : ""} px-7 pt-5 pb-12 focus:outline-none`}><Outlet /></main>
    <footer className="ds-footer">
      <div><strong>{BRAND_NAME}</strong><p>예측은 실제 성과와 다릅니다. 데이터의 출처와 기준 시각을 함께 확인하세요.</p></div>
      <nav aria-label="서비스 안내"><NavLink to={paths.about}>서비스 소개</NavLink><NavLink to={paths.history}>기록 확인</NavLink></nav>
    </footer>
  </div>;
}
