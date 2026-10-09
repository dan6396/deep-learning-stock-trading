import { afterEach, expect, it, vi } from "vitest";
import { focusMountedMain, scrollMountedHash } from "./routeFocus";
afterEach(() => { document.body.innerHTML = ""; });

it("focuses a main mounted after the old 30-frame limit", async () => {
  const cancel = focusMountedMain("/next/rank");
  await new Promise(resolve => setTimeout(resolve, 600));
  const main = document.createElement("main"); main.id = "main-content"; main.tabIndex = -1; main.dataset.routePath = "/next/rank";
  main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList);
  document.body.append(main);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(main); cancel();
});

it("scrolls the hash target after the matching lazy route mounts", async () => {
  const cancel = scrollMountedHash("/", "#candidate-heading");
  const main = document.createElement("main"); main.id = "main-content"; main.dataset.routePath = "/";
  main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList);
  const target = document.createElement("h2"); target.id = "candidate-heading";
  target.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList); target.scrollIntoView = vi.fn();
  main.append(target); document.body.append(main); await Promise.resolve();
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" }); cancel();
});
it("cancels a pending hash scroll when the user interacts", async () => {
  const cancel = scrollMountedHash("/", "#candidate-heading"); document.dispatchEvent(new Event("wheel"));
  const main = document.createElement("main"); main.id = "main-content"; main.dataset.routePath = "/";
  main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList);
  const target = document.createElement("h2"); target.id = "candidate-heading";
  target.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList); target.scrollIntoView = vi.fn();
  main.append(target); document.body.append(main); await Promise.resolve();
  expect(target.scrollIntoView).not.toHaveBeenCalled(); cancel();
});
it("finishes observation when the mounted route has no matching hash target", async () => {
  const main = document.createElement("main"); main.id = "main-content"; main.dataset.routePath = "/";
  main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList); document.body.append(main);
  const cancel = scrollMountedHash("/", "#missing-heading");
  const target = document.createElement("h2"); target.id = "missing-heading";
  target.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList); target.scrollIntoView = vi.fn();
  main.append(target); await Promise.resolve(); expect(target.scrollIntoView).not.toHaveBeenCalled(); cancel();
});
it("cancels pending focus when navigation changes", async () => {
  const cancel = focusMountedMain("/next/rank"); cancel();
  const main = document.createElement("main"); main.id = "main-content"; main.tabIndex = -1; main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList);
  document.body.append(main); await Promise.resolve(); expect(document.activeElement).not.toBe(main);
});

it.each(["pointerdown", "keydown", "wheel", "touchstart"])("does not steal focus after user %s while the route loads", async event => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  const cancel = focusMountedMain("/history");
  button.dispatchEvent(new Event(event, { bubbles: true }));
  const main = document.createElement("main"); main.id = "main-content"; main.tabIndex = -1; main.dataset.routePath = "/history";
  main.getClientRects = vi.fn(() => ({ length: 1 }) as DOMRectList); document.body.append(main);
  await Promise.resolve(); expect(button).toHaveFocus(); cancel();
});
