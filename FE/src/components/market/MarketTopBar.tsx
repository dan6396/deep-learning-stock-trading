import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import type { StockQuote } from "../../types/trading";

export const marketNavItems = [
  { id: "market-home", label: "홈" },
  { id: "market-table", label: "AI 후보" },
] as const;

const MAX_RESULTS = 6;
const LISTBOX_ID = "market-search-listbox";

function normalizeSearch(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function formatRate(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Shared top bar for the dashboard and stock pages. On the dashboard the tabs
 * scroll in-page (`onNavigate`); elsewhere they link back to the dashboard
 * sections. The search field follows the ARIA combobox pattern: arrow keys move
 * through results, Enter opens the highlighted stock, Escape closes.
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
  const [activeIndex, setActiveIndex] = useState(-1);
  // Narrow screens only: the search field is revealed by the toggle button.
  const [isSearchExpanded, setSearchExpanded] = useState(false);

  const normalizedQuery = normalizeSearch(query);
  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return stocks
      .filter((stock) => normalizeSearch(`${stock.name}${stock.code}`).includes(normalizedQuery))
      .slice(0, MAX_RESULTS);
  }, [normalizedQuery, stocks]);

  const isListOpen = isSearchOpen && searchResults.length > 0;
  const showEmpty = isSearchOpen && Boolean(query) && searchResults.length === 0;
  const activeId = isListOpen && activeIndex >= 0 ? `${LISTBOX_ID}-${activeIndex}` : undefined;

  useEffect(() => {
    if (isSearchExpanded) {
      inputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [normalizedQuery]);

  function openStock(stock: StockQuote) {
    setQuery("");
    setSearchOpen(false);
    setSearchExpanded(false);
    navigate(`/stock/${stock.code}`);
  }

  function dismissSearch() {
    setSearchOpen(false);
    setSearchExpanded(false);
    setActiveIndex(-1);
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
        {isSearchExpanded ? <X aria-hidden="true" size={20} /> : <Search aria-hidden="true" size={20} />}
      </button>
      <div className="market-search-wrap" id="market-search">
        <form
          className="market-search"
          onSubmit={(event) => {
            event.preventDefault();
            const target = searchResults[activeIndex] ?? searchResults[0];
            if (target) {
              openStock(target);
            }
          }}
          role="search"
        >
          <Search aria-hidden="true" size={16} />
          <input
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-expanded={isListOpen}
            aria-label="국내 종목 검색"
            autoComplete="off"
            onBlur={() => setSearchOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                dismissSearch();
                return;
              }
              if (event.key === "Enter" && isListOpen && activeIndex >= 0) {
                event.preventDefault();
                openStock(searchResults[activeIndex]);
                return;
              }
              if (!searchResults.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
                return;
              }
              event.preventDefault();
              setSearchOpen(true);
              setActiveIndex((current) => {
                const step = event.key === "ArrowDown" ? 1 : -1;
                return (current + step + searchResults.length) % searchResults.length;
              });
            }}
            placeholder="종목명 또는 종목코드 검색"
            ref={inputRef}
            role="combobox"
            type="search"
            value={query}
          />
          {query ? (
            <button
              className="search-clear"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
                inputRef.current?.focus();
              }}
              type="button"
              aria-label="검색어 지우기"
            >
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </form>
        <ul className="search-results" hidden={!isListOpen} id={LISTBOX_ID} role="listbox" aria-label="종목 검색 결과">
          {searchResults.map((stock, index) => (
            <li
              aria-selected={index === activeIndex}
              className="search-result-button"
              id={`${LISTBOX_ID}-${index}`}
              key={stock.code}
              // mousedown would blur the input (closing the list) before click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openStock(stock)}
              role="option"
            >
              <span>{stock.name}</span>
              <strong>{stock.code}</strong>
              <small className={`market-change market-change--${stock.direction}`}>{formatRate(stock.changeRate)}</small>
            </li>
          ))}
        </ul>
        {showEmpty ? (
          <p className="search-results search-empty" role="status">
            일치하는 KOSPI 종목이 없습니다.
          </p>
        ) : null}
      </div>
    </header>
  );
}
