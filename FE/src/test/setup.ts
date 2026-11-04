import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Existing suites cover the validated pipeline; unfiltered mode is tested with an explicit "off".
process.env.BRIEFING_NARRATIVE_VALIDATION ??= "on";

afterEach(() => {
  cleanup();
  if (typeof window === "undefined") return;
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.theme;
});
