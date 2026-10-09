import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Play, LoaderCircle, X } from "lucide-react";
import { queries } from "../../shared/api/queries";
import { AnalysisControl } from "./AnalysisControl";
import "./briefing.css";
import "./analysisDialog.css";

/** Match native radio tab stops; unchecked members must not become trap boundaries. */
export function dialogTabStops(dialog: HTMLElement) {
  const nodes = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.tabIndex >= 0 && !node.closest("[hidden],[inert]"));
  return nodes.filter(node => {
    if (!(node instanceof HTMLInputElement) || node.type !== "radio" || !node.name) return true;
    const group = nodes.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === "radio" && item.name === node.name && item.form === node.form);
    return node === (group.find(item => item.checked) ?? group[0]);
  });
}

function DialogContent({ close, running }: { close: (restore?: boolean) => void; running: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current, bodyOverflow = document.body.style.overflow, rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden"; document.documentElement.style.overflow = "hidden";
    if (node?.showModal) node.showModal(); else node?.setAttribute("open", ""); closeButton.current?.focus();
    return () => { if (node?.open) node.close?.(); document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = rootOverflow; };
  }, []);
  function dismiss() { if (dialog.current?.open) dialog.current.close?.(); close(); }
  return createPortal(<dialog ref={dialog} className="ds-root briefing-page analysis-dialog" aria-labelledby="analysis-dialog-title" onCancel={event => { event.preventDefault(); dismiss(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    // Leave interior navigation to showModal, wrapping only the first/last
    // actual tab stop so browser chrome cannot interrupt the dialog sequence.
    const nodes = dialogTabStops(event.currentTarget), first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="analysis-dialog-heading"><h2 id="analysis-dialog-title">AI 분석 실행</h2><button ref={closeButton} type="button" className="briefing-icon-button" aria-label="분석 실행 대화상자 닫기" onClick={dismiss}><X aria-hidden="true" size={20} /></button></div>
    {running && <p className="analysis-dialog-running" role="status">대화상자를 닫아도 분석은 서버에서 계속 진행됩니다.</p>}
    <AnalysisControl />
  </dialog>, document.body);
}
export function AnalysisDialog() {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), location = useLocation();
  const route = `${location.pathname}${location.search}`, previousRoute = useRef(route);
  const run = useQuery(queries.analysisRun()), backend = useQuery(queries.backendStatus());
  const running = run.data?.data.status === "running" || backend.data?.runtime.state === "running";
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus(); }
  useEffect(() => { if (previousRoute.current !== route) { previousRoute.current = route; if (open) close(false); } }, [route, open]);
  return <><button ref={trigger} type="button" className="ds-analysis-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{running ? <LoaderCircle className="analysis-spinner" aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}<span>{running ? "분석 진행 중" : "AI 분석 실행"}</span></button>{open && <DialogContent close={close} running={running} />}</>;
}
