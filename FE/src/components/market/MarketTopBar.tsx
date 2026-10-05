import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { StockQuote } from "../../types/trading";

export const marketNavItems = [
  { id: "market-home", label: "홈" },
  { id: "market-table", label: "AI 후보" },
] as const;

function normalizeSearch(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function formatRate(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Shared top bar for the dashboard and stock pages. On the dashboard the tabs
 * scroll in-page (`onNavigate`); elsewhere they link back to the dashboard
 * sections. Picking a search result opens that stock's report page.
 */
export function MarketTopBar({
  activeSection,
  onNavigate,
  stocks,
}: {
  activeSection?: string;
  onNavigate?: (sectionId: string) => void;
  stocks: StockQuote[];
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [isSearchOpen, setSearchOpen] = useState(false);
  // Narrow screens only: the search field is revealed by the toggle button.
  const [isSearchExpanded, setSearchExpanded] = useState(false);

  const normalizedQuery = normalizeSearch(query);
  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return stocks.filter((stock) => normalizeSearch(`${stock.name}${stock.code}`).includes(normalizedQuery));
  }, [normalizedQuery, stocks]);

  useEffect(() => {
    if (isSearchExpanded) {
      inputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  function openStock(stock: StockQuote) {
    setQuery("");
    setSearchOpen(false);
    setSearchExpanded(false);
    navigate(`/stock/${stock.code}`);
  }

  function dismissSearch() {
    setSearchOpen(false);
    setSearchExpanded(false);
  }

  return (
    <header className={`market-topbar ${isSearchExpanded ? "market-topbar--search-open" : ""}`}>
      <Link className="market-brand" to="/" aria-label="KOSPI AI Trading Desk 홈">
        <span className="market-brand__mark" aria-hidden="true">
          <svg viewBox="0 0 28 28" focusable="false">
            <path d="M6 19.5L11 14l4 3.5 7-9" />
            <circle cx="6" cy="19.5" r="1.6" />
            <circle cx="11" cy="14" r="1.6" />
            <circle cx="15" cy="17.5" r="1.6" />
            <circle cx="22" cy="8.5" r="1.6" />
          </svg>
        </span>
        <strong>KOSPI AI Trading Desk</strong>
      </Link>
      <nav className="market-tabs" aria-label="주요 메뉴">
        {marketNavItems.map((item) =>
          onNavigate ? (
            <a
              aria-current={activeSection === item.id ? "page" : undefined}
              href={`#${item.id}`}
              key={item.id}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(item.id);
              }}
            >
              {item.label}
            </a>
          ) : (
            <Link key={item.id} to={`/dashboard#${item.id}`}>
              {item.label}
            </Link>
          ),
        )}
      </nav>
      <button
        aria-controls="market-search"
        aria-expanded={isSearchExpanded}
        aria-label={isSearchExpanded ? "종목 검색 닫기" : "종목 검색 열기"}
        className="market-search-toggle"
        onClick={() => {
          setSearchExpanded((value) => !value);
          setSearchOpen(false);
        }}
        type="button"
      >
        <span aria-hidden="true">{isSearchExpanded ? "×" : "⌕"}</span>
      </button>
      <div className="market-search-wrap" id="market-search">
        <form
          className="market-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchResults[0]) {
              openStock(searchResults[0]);
            }
          }}
          role="search"
        >
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="국내 종목 검색"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                dismissSearch();
              }
            }}
            placeholder="종목명 또는 종목코드 검색"
            ref={inputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              className="search-clear"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
              type="button"
              aria-label="검색어 지우기"
            >
              ×
            </button>
          ) : null}
        </form>
        {query && isSearchOpen ? (
          <div className="search-results" role="listbox" aria-label="종목 검색 결과">
            {searchResults.length > 0 ? (
              searchResults.slice(0, 6).map((stock) => (
                <button
                  className="search-result-button"
                  key={stock.code}
                  onClick={() => openStock(stock)}
                  role="option"
                  type="button"
                >
                  <span>{stock.name}</span>
                  <strong>{stock.code}</strong>
                  <small className={`market-change market-change--${stock.direction}`}>
                    {formatRate(stock.changeRate)}
                  </small>
                </button>
              ))
            ) : (
              <p className="search-empty">일치하는 KOSPI 종목이 없습니다.</p>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
