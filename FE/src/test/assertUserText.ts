import { expect } from "vitest";

/** Shared presentation guard: machine identifiers belong in attributes, never copy. */
export function expectReadableUserText(root: HTMLElement) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT), pieces: string[] = [];
  while (walker.nextNode()) pieces.push(walker.currentNode.textContent ?? "");
  expect(pieces.join(" ").replace(/KOSPI AI Desk/g, "서비스").match(/\b(?:KOSPI200_NIGHT|UST10Y|USDKRW|NASDAQ|SP500|KOSPI|KOSDAQ)\b|\b[a-z]+_[a-z_]+\b|macroStale|fallbackReason|MODEL UNIVERSE|STOCK REPORT|PRICE OBSERVATIONS|MODEL & EVIDENCE|ANALYSIS RECORDS|NEW ANALYSIS|PREDICTION TRACKING|YOUR WATCHLIST|\bQUOTE\b|\bPREDICTION\b|m[0-9]-[0-9]{4}-[0-9]{2}-[0-9]{2}/)?.[0]).toBeUndefined();
}
