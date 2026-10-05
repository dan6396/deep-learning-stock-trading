import { lazy, Suspense, useEffect, useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { LoadingView } from "./components/common/StatusView";

// Split each route into its own chunk so the initial landing load doesn't pull
// in the heavy dashboard (table, candle chart, KIS client) until it's visited.
const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StockDetailPage = lazy(() => import("./pages/StockDetailPage").then((module) => ({ default: module.StockDetailPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

const MAIN_ID = "main-content";

/** Focuses the page's main landmark once it has rendered (routes load lazily). */
function focusMain(attempt = 0) {
  const main = document.getElementById(MAIN_ID);
  if (main) {
    main.focus({ preventScroll: true });
    return;
  }
  if (attempt < 30) {
    requestAnimationFrame(() => focusMain(attempt + 1));
  }
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  // Compare paths rather than counting renders: StrictMode runs effects twice.
  const previousPath = useRef(pathname);

  useEffect(() => {
    // Screen-reader and keyboard users land at the new page's content instead
    // of wherever focus was on the previous page. Skip the initial load.
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      focusMain();
    }

    // A hash means the user is deep-linking to a section (e.g. /dashboard#market-table);
    // let that section's own scroll handler take over instead of jumping to the top.
    if (hash) {
      return;
    }

    window.scrollTo({ top: 0, behavior: "auto" });
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
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/stock/:code" element={<StockDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
