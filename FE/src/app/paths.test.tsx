import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppPaths } from "./paths";
function Paths() { const p = useAppPaths(); return <output>{JSON.stringify({ ...p, stock: p.stock("005930") })}</output>; }
it.each(["/", "/rank", "/nextish", "/next", "/next/", "/next/history", "/legacy"])("resolves all menu destinations at %s", pathname => {
  render(<MemoryRouter initialEntries={[pathname]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Paths /></MemoryRouter>);
  const base = pathname === "/next" || pathname.startsWith("/next/") ? "/next" : "";
  expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({ briefing: base || "/", rank: `${base}/rank`, watchlist: `${base}/watchlist`, history: `${base}/history`, about: `${base}/about`, stock: `${base}/stock/005930` });
});
