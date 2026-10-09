/** Wait for the mounted route landmark, with cancellation instead of a frame limit. */
export function focusMountedMain(pathname: string): () => void {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    observer.disconnect();
    for (const event of events) document.removeEventListener(event, cancel, true);
  };
  const events = ["pointerdown", "keydown", "wheel", "touchstart"];
  const observer = new MutationObserver(() => { tryFocus(); });
  function tryFocus() {
    if (cancelled) return;
    const main = document.getElementById("main-content");
    if (!main || main.getClientRects().length === 0) return;
    const routePath = main.getAttribute("data-route-path");
    if (routePath !== null && routePath !== pathname) return;
    main.focus({ preventScroll: true });
    if (document.activeElement === main) cancel();
  }
  for (const event of events) document.addEventListener(event, cancel, { capture: true, passive: true });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-route-path"] });
  tryFocus();
  return cancel;
}

/** Resolve deep links after a lazy page mounts, unless the user starts interacting. */
export function scrollMountedHash(pathname: string, hash: string): () => void {
  let observer: MutationObserver;
  const events = ["pointerdown", "keydown", "wheel", "touchstart"];
  const cancel = () => { observer.disconnect(); for (const event of events) document.removeEventListener(event, cancel, true); };
  const tryScroll = () => {
    const main = document.getElementById("main-content");
    if (main?.dataset.routePath !== pathname || !main.getClientRects().length) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { cancel(); return; }
    const target = document.getElementById(id);
    if (!target) { cancel(); return; }
    if (!target.getClientRects().length) return;
    target.scrollIntoView({ block: "start", behavior: "auto" }); cancel();
  };
  observer = new MutationObserver(tryScroll);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-route-path"] });
  for (const event of events) document.addEventListener(event, cancel, { capture: true, passive: true });
  tryScroll(); return cancel;
}
