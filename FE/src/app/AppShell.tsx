import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { BRAND_NAME, BrandMark } from "../shared/lib/brand";
import { useTheme } from "./providers";
import { useAppPaths } from "./paths";
import { SearchDialog } from "../features/search/SearchDialog";
import { ConnectionNotice } from "../features/connection/ConnectionNotice";
import { AnalysisDialog } from "../features/briefing/AnalysisDialog";

export const NEXT_BASE = "/next";

export function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const paths = useAppPaths();
  const tabs = [
    { to: paths.briefing, label: "브리핑", end: true },
    { to: paths.rank, label: "전체 순위", end: false },
    { to: paths.watchlist, label: "관심", end: false },
    { to: paths.history, label: "분석 기록", end: false },
  ];
  return <div className="ds-root min-h-dvh bg-bg font-sans text-fg antialiased">
    <header className="ds-header sticky top-0 z-10 bg-surface">
      <NavLink to={paths.briefing} className="ds-brand"><BrandMark className="size-7 text-fg" /><span>{BRAND_NAME}</span></NavLink>
      <nav aria-label="주요 메뉴" className="ds-nav">
        {tabs.map(tab => <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `ds-nav-link${isActive ? " ds-nav-active" : ""}`}>{tab.label}</NavLink>)}
      </nav>
      <div className="ds-header-actions">
        <SearchDialog />
        <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"} className="ds-theme-button">
          {theme === "dark" ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
        </button>
        <AnalysisDialog />
      </div>
    </header>
    <main id="main-content" data-route-path={pathname} tabIndex={-1} className={`ds-main${pathname === paths.briefing ? " ds-main-briefing" : ""} px-7 pt-5 pb-12 focus:outline-none`}><ConnectionNotice /><Outlet /></main>
    <footer className="ds-footer">
      <div><strong>{BRAND_NAME}</strong><p>예측은 실제 성과와 다릅니다. 데이터의 출처와 기준 시각을 함께 확인하세요.</p></div>
      <nav aria-label="서비스 안내"><NavLink to={paths.about}>서비스 소개</NavLink><NavLink to={paths.history}>기록 확인</NavLink></nav>
    </footer>
  </div>;
}
