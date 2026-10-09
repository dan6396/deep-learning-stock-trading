import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, ArrowUpRight } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { queries } from "../../shared/api/queries";
import { formatPercent } from "../../shared/lib/format";
import { matchStock } from "../rank/rankData";
import { SourceMeta } from "../briefing/SourceMeta";
import { WatchToggle, WatchlistNotice } from "../watchlist/WatchToggle";
import "../briefing/briefing.css";
import "./search.css";

function SearchContent({ close, dialog }: { close: (restore?: boolean) => void; dialog: RefObject<HTMLDialogElement> }) {
  const input = useRef<HTMLInputElement>(null), paths = useAppPaths();
  const composing = useRef(false);
  const rank = useQuery(queries.rank()), [query, setQuery] = useState("");
  const rows = (rank.data?.data ?? []).filter(row => matchStock(row, query)), visible = rows.slice(0, 30);
  useEffect(() => {
    const node = dialog.current;
    if (node?.showModal) node.showModal(); else node?.setAttribute("open", "");
    input.current?.focus();
    return () => { if (node?.open) node.close?.(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="ds-root search-dialog" aria-labelledby="stock-search-title" onCancel={event => { event.preventDefault(); if (!composing.current) close(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="search-dialog-heading"><div><p>전체 분석 집합에서 찾기</p><h2 id="stock-search-title">종목 검색</h2></div><button type="button" className="search-close" aria-label="종목 검색 닫기" onClick={() => close()}><X aria-hidden="true" size={19} /></button></div>
    <label className="search-dialog-input"><Search aria-hidden="true" size={20} /><span className="watch-sr-only">검색할 종목 이름 또는 코드</span><input ref={input} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름 또는 6자리 코드" autoComplete="off" /></label>
    <WatchlistNotice />
    {rank.data && <SourceMeta source={rank.data.source} asOf={rank.data.asOf} label="전체 순위 저장 시각" />}
    {rank.data?.source === "sample" && <p className="search-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
    {rank.isError && <p className="search-notice" role="status">{rank.data ? "이전 조회 결과 · 검색 자료 갱신 실패" : "전체 순위 조회 실패"}<button className="search-retry" onClick={() => void rank.refetch({ cancelRefetch: true })}>다시 조회</button></p>}
    <p className="search-count" aria-live="polite">{rank.isPending ? "전체 순위를 조회하고 있습니다." : !rank.data ? "검색 자료 미확인" : `전체 ${rank.data.data.length}종목 중 ${rows.length}종목 일치`}</p>
    <div className="stock-search-results">{visible.length ? <ul>{visible.map(row => <li key={row.code} data-search-code={row.code}><Link to={paths.stock(row.code)} onClick={() => close(false)}><span><strong>{row.name ?? "이름 미확인"}</strong><small>{row.code} · 모델 예측 {formatPercent(row.predictedReturn)}</small></span><ArrowUpRight aria-hidden="true" size={17} /></Link><WatchToggle code={row.code} name={row.name} /></li>)}</ul>
      : !rank.isPending && !rank.isError && <p className="stock-search-empty">{rank.data?.data.length ? "검색 조건에 맞는 종목이 없습니다." : "최신 전체 분석 결과가 비어 있습니다."}</p>}
      {rows.length > visible.length && <p className="search-count">처음 30종목을 표시합니다. 이름이나 코드를 더 입력해 좁혀 주세요.</p>}</div>
    <p className="search-footer">최종 후보 목록으로 검색 범위를 줄이지 않습니다. 예측은 실제 성과가 아닙니다. Esc로 닫기</p>
  </dialog>, document.body);
}

export function SearchDialog({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), previous = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), location = useLocation(), route = `${location.key}:${location.pathname}${location.search}${location.hash}`, previousRoute = useRef(route);
  function show() { previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current; setOpen(true); }
  function close(restore = true) { if (dialog.current?.open) dialog.current.close?.(); setOpen(false); onClose?.(); if (restore) (previous.current?.isConnected ? previous.current : trigger.current)?.focus(); }
  useEffect(() => { if (previousRoute.current !== route) { previousRoute.current = route; if (open) close(false); } }, [route, open]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault(); if (!open) show();
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [open]);
  return <><span className="search-trigger-group"><button ref={trigger} type="button" className="search-trigger" aria-label="종목 검색" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" aria-expanded={open} onClick={show}><Search aria-hidden="true" size={18} /><span>종목 검색</span></button><kbd aria-hidden="true">⌘K</kbd></span>{open && <SearchContent close={close} dialog={dialog} />}</>;
}
