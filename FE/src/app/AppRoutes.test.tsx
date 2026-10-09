import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useParams } from "react-router-dom";
import { AppProviders } from "./providers";
import App from "../App";
import { jsonResponse, pipelineRow } from "../test/dataFixtures";

vi.mock("../features/briefing/BriefingPage", () => ({ BriefingPage: () => <h1 id="candidate-heading">테스트 브리핑</h1> }));
vi.mock("../features/stock/StockReportPage", () => ({ StockReportPage: () => <h1>테스트 리포트 {useParams().code}</h1> }));
vi.mock("../pages/LandingPage", () => ({ LandingPage: () => <main><h1>기존 랜딩</h1></main> }));
vi.mock("../pages/DashboardPage", () => ({ DashboardPage: () => <main><h1>기존 대시보드</h1></main> }));
vi.mock("../pages/StockDetailPage", () => ({ StockDetailPage: () => <main><h1>기존 종목 {useParams().code}</h1></main> }));
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => String(url) === "/api/candidates/run" ? jsonResponse({ status: "idle" }) : jsonResponse([pipelineRow()])));
});
afterEach(() => { vi.unstubAllGlobals(); document.head.querySelectorAll('meta[name="robots"]').forEach(meta => meta.remove()); });
function Location() { const loc = useLocation(); return <output data-testid="route-location">{loc.pathname}{loc.search}{loc.hash}</output>; }
function mount(path = "/") {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProviders><Location /><App /></AppProviders></MemoryRouter>);
}
it.each(["/", "/next"])("mounts the rebuilt home and shell at %s", async path => {
  mount(path); await screen.findByRole("heading", { name: "테스트 브리핑" });
  expect(screen.getByRole("link", { name: "브리핑" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "종목 검색" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "서비스 소개" })).toHaveAttribute("href", path === "/next" ? "/next/about" : "/about");
});
it("keeps dashboard query and adapts its table deep link", async () => {
  mount("/dashboard?code=005930&sort=model#market-table"); await screen.findByRole("heading", { name: "테스트 브리핑" });
  expect(screen.getByTestId("route-location")).toHaveTextContent("/?code=005930&sort=model#candidate-heading");
});
it.each([["/legacy", "기존 랜딩"], ["/legacy/dashboard", "기존 대시보드"], ["/legacy/stock/005930", "기존 종목 005930"]])("preserves %s", async (path, title) => {
  mount(path); expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
});
it.each(["/missing", "/next/missing"])("keeps the shell and correct home link for %s", async path => {
  mount(path); await screen.findByRole("heading", { name: "페이지를 찾을 수 없습니다" });
  expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "브리핑으로 돌아가기" })).toHaveAttribute("href", path.startsWith("/next/") ? "/next" : "/");
  expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  fireEvent.click(screen.getByRole("link", { name: "브리핑으로 돌아가기" })); await screen.findByRole("heading", { name: "테스트 브리핑" });
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
});
it("restores a preexisting robots policy after leaving the unknown route", async () => {
  const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "index,follow"; document.head.append(meta);
  mount("/unknown"); await screen.findByRole("heading", { name: "페이지를 찾을 수 없습니다" });
  expect(meta.content).toBe("noindex");
  fireEvent.click(screen.getByRole("link", { name: "브리핑으로 돌아가기" })); await screen.findByRole("heading", { name: "테스트 브리핑" });
  expect(meta.content).toBe("index,follow");
});
it("integrates search close focus, report navigation, and theme changes", async () => {
  mount("/next"); await screen.findByRole("heading", { name: "테스트 브리핑" });
  const trigger = screen.getByRole("button", { name: "종목 검색" }); trigger.focus(); fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "종목 검색" });
  expect(screen.getByRole("searchbox")).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(trigger).toHaveFocus();
  fireEvent.click(trigger); await screen.findByRole("dialog");
  fireEvent.click(await screen.findByRole("link", { name: /테스트 종목/ }));
  await screen.findByRole("heading", { name: "테스트 리포트 005930" });
  expect(screen.getByTestId("route-location")).toHaveTextContent("/next/stock/005930");
  fireEvent.click(screen.getByRole("button", { name: "밝은 테마로 전환" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});
