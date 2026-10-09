import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProviders } from "./providers";
import { AppShell } from "./AppShell";
import { THEME_STORAGE_KEY, resolveInitialTheme } from "./theme";

describe("resolveInitialTheme", () => {
  it("defaults to dark when nothing valid is stored", () => {
    expect(resolveInitialTheme(null)).toBe("dark");
    expect(resolveInitialTheme("purple")).toBe("dark");
  });

  it("keeps a stored choice", () => {
    expect(resolveInitialTheme("light")).toBe("light");
  });
});

function renderShell() {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={["/next"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/next" element={<AppShell />}>
            <Route index element={<p>브리핑 본문</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("AppShell theme toggle", () => {
  it("starts dark, switches to light, and remembers the choice", () => {
    renderShell();
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "밝은 테마로 전환" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByRole("button", { name: "어두운 테마로 전환" })).toBeInTheDocument();
  });

  it("marks the current tab and renders the page inside main", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "브리핑" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("main")).toHaveTextContent("브리핑 본문");
  });
});
