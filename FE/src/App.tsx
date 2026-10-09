import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { LoadingView } from "./components/common/StatusView";
import { focusMountedMain, scrollMountedHash } from "./app/routeFocus";

// Split each route into its own chunk so the initial landing load doesn't pull
// in the heavy dashboard (table, candle chart, KIS client) until it's visited.
const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StockDetailPage = lazy(() => import("./pages/StockDetailPage").then((module) => ({ default: module.StockDetailPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
// Rebuilt screens are the main site; /next remains a compatible preview alias.
const AppShell = lazy(() => import("./app/AppShell").then((module) => ({ default: module.AppShell })));
const BriefingPage = lazy(() => import("./features/briefing/BriefingPage").then((module) => ({ default: module.BriefingPage })));
const StockReportPage = lazy(() => import("./features/stock/StockReportPage").then((module) => ({ default: module.StockReportPage })));
const RankPage = lazy(() => import("./features/rank/RankPage").then((module) => ({ default: module.RankPage })));
const WatchlistPage = lazy(() => import("./features/watchlist/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));
const HistoryPage = lazy(() => import("./features/history/HistoryPage").then((module) => ({ default: module.HistoryPage })));
const AboutPage = lazy(() => import("./features/about/AboutPage").then((module) => ({ default: module.AboutPage })));

const MAIN_ID = "main-content";

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  // Compare paths rather than counting renders: StrictMode runs effects twice.
  const previousPath = useRef(pathname);

  useEffect(() => {
    // Screen-reader and keyboard users land at the new page's content instead
    // of wherever focus was on the previous page. Skip the initial load.
    let cancelFocus: (() => void) | undefined;
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      cancelFocus = focusMountedMain(pathname);
    }

    // A hash means the user is deep-linking to a section (e.g. /dashboard#market-table);
    // let that section's own scroll handler take over instead of jumping to the top.
    if (hash) {
      const cancelHash = scrollMountedHash(pathname, hash);
      return () => { cancelFocus?.(); cancelHash(); };
    }

    window.scrollTo({ top: 0, behavior: "auto" });
    return cancelFocus;
  }, [pathname, hash]);

  return null;
}

function SkipLink() {
  return (
    <a
      className="skip-link"
      href={`#${MAIN_ID}`}
      onClick={(event) => {
        // Handle in place so the router doesn't treat it as a navigation.
        event.preventDefault();
        const main = document.getElementById(MAIN_ID);
        main?.focus();
        main?.scrollIntoView({ block: "start" });
      }}
    >
      본문으로 건너뛰기
    </a>
  );
}

function DashboardRedirect() {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: "/", search, hash: hash === "#market-table" ? "#candidate-heading" : hash }} />;
}

function appRoutes() {
  return <>
    <Route index element={<BriefingPage />} />
    <Route path="rank" element={<RankPage />} />
    <Route path="watchlist" element={<WatchlistPage />} />
    <Route path="history" element={<HistoryPage />} />
    <Route path="about" element={<AboutPage />} />
    <Route path="stock/:code" element={<StockReportPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SkipLink />
      <ScrollToTop />
      <Suspense
        fallback={
          <main className="page-status">
            <LoadingView label="화면을 불러오는 중입니다" />
          </main>
        }
      >
        <Routes>
          <Route path="/dashboard" element={<DashboardRedirect />} />
          <Route path="/legacy" element={<LandingPage />} />
          <Route path="/legacy/dashboard" element={<DashboardPage />} />
          <Route path="/legacy/stock/:code" element={<StockDetailPage />} />
          <Route path="/next" element={<AppShell />}>{appRoutes()}</Route>
          <Route path="/" element={<AppShell />}>{appRoutes()}</Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
