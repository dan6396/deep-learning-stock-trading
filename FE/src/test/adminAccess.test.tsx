import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppProviders } from "../app/providers";
import { AppShell } from "../app/AppShell";
import { AnalysisControl } from "../features/briefing/AnalysisControl";
import { BriefingNarrativeCard } from "../features/briefing/BriefingNarrativeCard";
import { adaptBriefing } from "../entities/briefing";
import { createApiClient } from "../shared/api/client";
import { getAdminToken, setAdminToken } from "../shared/api/adminAccess";
import { backendStatusBody, jsonResponse } from "./dataFixtures";

vi.mock("../features/search/SearchDialog", () => ({ SearchDialog: () => null }));
vi.mock("../features/connection/ConnectionNotice", () => ({ ConnectionNotice: () => null }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function Reopen() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate("/?admin")}>관리자 설정 열기</button><output>{location.search}</output></>; }
function mount(entry = "/?admin") {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => jsonResponse(String(url).includes("backend/status") ? backendStatusBody() : { status: "idle" })));
  return render(<MemoryRouter initialEntries={[entry]}><AppProviders><Reopen /><AppShell /></AppProviders></MemoryRouter>);
}
describe("admin session controls", () => {
  it("leaves public headers free of analysis controls and permission notices", () => {
    mount("/");
    expect(screen.queryByRole("button", { name: "AI 분석 실행" })).not.toBeInTheDocument();
    expect(screen.queryByText("관리자만 실행할 수 있습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("opens a labelled password dialog, saves only in session storage, and revokes access", async () => {
    mount();
    const input = screen.getByLabelText("관리자 API 토큰"); expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("dialog", { name: "관리자 모드" })).toHaveAccessibleDescription("토큰은 현재 탭의 세션 저장소에만 저장합니다. 인증은 실행 요청 때 확인합니다.");
    expect(screen.queryByRole("button", { name: "AI 분석 실행" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "fixture-admin" } }); fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(getAdminToken()).toBe("fixture-admin"); expect(window.localStorage.length).toBe(0);
    expect(screen.getByRole("button", { name: "AI 분석 실행" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "관리자 설정 열기" }));
    expect(screen.getByLabelText("관리자 API 토큰")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "해제" }));
    await waitFor(() => expect(getAdminToken()).toBe(""));
    expect(screen.queryByRole("button", { name: "AI 분석 실행" })).not.toBeInTheDocument();
  });
  it("hides analysis and narrative launch controls without a token and updates on revoke", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "idle" })));
    const narrative = adaptBriefing({ version: 1, status: "ready", stocks: [], narrative: { status: "template" } }).narrative;
    render(<MemoryRouter><AppProviders><AnalysisControl /><BriefingNarrativeCard narrative={narrative} stocks={[]} isGenerating={false} generateError={null} onGenerate={vi.fn()} onCitationClick={vi.fn()} /></AppProviders></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "분석 시작" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("narrative-generate-btn")).not.toBeInTheDocument();
    expect(screen.getByText("새 분석은 장 마감 후 자동으로 생성됩니다.")).toBeInTheDocument();
    expect(screen.queryByText("관리자만 실행할 수 있습니다")).not.toBeInTheDocument();
    act(() => setAdminToken("fixture-admin")); expect(screen.getByTestId("narrative-generate-btn")).toBeInTheDocument();
    act(() => setAdminToken("")); expect(screen.queryByTestId("narrative-generate-btn")).not.toBeInTheDocument();
  });
  it.each([true, false])("hides admin regeneration hints and request errors from public narrative cards (recent=%s)", recent => {
    const narrative = adaptBriefing({ narrative: { status: "llm", generatedAt: new Date(Date.now() - (recent ? 0 : 700_000)).toISOString() } }).narrative;
    render(<BriefingNarrativeCard narrative={narrative} stocks={[]} isGenerating={false} generateError="fixture administrative failure" onGenerate={vi.fn()} onCitationClick={vi.fn()} />);
    expect(screen.queryByTestId("partial-template-policy-hint")).not.toBeInTheDocument();
    expect(screen.queryByText("fixture administrative failure")).not.toBeInTheDocument();
    expect(screen.queryByText("관리자만 실행할 수 있습니다")).not.toBeInTheDocument();
    act(() => setAdminToken("fixture-admin"));
    expect(screen.getByTestId("partial-template-policy-hint")).toHaveTextContent(recent ? "최근 생성 후 10분" : "시장 지표가 갱신되면");
    expect(screen.getByRole("alert")).toHaveTextContent("fixture administrative failure");
  });
  it("adds bearer credentials to POST only and drops them after revocation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})), client = createApiClient("", fetcher);
    setAdminToken("fixture-admin");
    await client.request("/api/briefing"); await client.request("/api/briefing/narrative", { method: "POST" });
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty("Authorization", "Bearer fixture-admin");
    setAdminToken(""); await client.request("/api/briefing/narrative", { method: "POST" });
    expect(fetcher.mock.calls[2][1]?.headers).not.toHaveProperty("Authorization");
  });
  it.each([401, 403, 429])("shows recovery guidance for HTTP %s", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status, headers: { "Retry-After": "42" } }));
    await expect(createApiClient("", fetcher).request("/api/briefing/narrative", { method: "POST" })).rejects.toMatchObject({ status, message: expect.stringMatching(status === 401 ? /관리자 인증이 필요합니다/ : status === 403 ? /수시 실행/ : /42초 후 다시 시도/) });
  });
  it.each([
    [{ kind: "official", runId: "fixture-official" }, "다른 분석(공식 예약 실행)이 진행 중입니다. 끝난 뒤 다시 시도해 주세요."],
    [{ kind: "adhoc" }, "다른 분석(관리자 수시 실행)이 진행 중입니다. 끝난 뒤 다시 시도해 주세요."],
    [{ kind: "unknown", error: "untrusted internal details" }, "다른 분석이 진행 중입니다. 끝난 뒤 다시 시도해 주세요."],
  ])("uses recognized conflict metadata for 409 feedback (%j)", async (body, message) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 409, headers: { "Content-Type": "application/json" } }));
    await expect(createApiClient("", fetcher).request("/api/candidates/run", { method: "POST" })).rejects.toMatchObject({ status: 409, message });
  });
  it("keeps helpful 409 guidance when the error body cannot be read", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("not json", { status: 409 }));
    await expect(createApiClient("", fetcher).request("/api/candidates/run", { method: "POST" })).rejects.toMatchObject({ status: 409, message: "다른 분석이 진행 중입니다. 끝난 뒤 다시 시도해 주세요." });
  });
});
