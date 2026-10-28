export type OpinionCitationTarget = { targetId: string; label: string };

export function StockCitationChips({ ids, targets, label }: { ids: string[]; targets: Map<string, OpinionCitationTarget>; label: string }) {
  const citations = [...new Set(ids)].flatMap(id => { const target = targets.get(id); return target ? [{ id, ...target }] : []; });
  if (!citations.length) return null;
  function reveal(targetId: string) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
  }
  return <div className="stock-opinion-citations" role="group" aria-label={label}>{citations.map(citation => <button type="button" key={citation.id} title={citation.id} onClick={() => reveal(citation.targetId)}>{citation.label}</button>)}</div>;
}
