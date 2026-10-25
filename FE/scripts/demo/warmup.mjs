import { pathToFileURL } from "node:url";

/** Read-only, sequential cache preparation. Never starts analysis or AI generation. */
export async function warmup(base = "http://127.0.0.1:5173", { transport = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const origin = new URL(base);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) throw new Error("서버 주소를 확인하세요.");
  const rows = [];
  let rank = [], stocks = [];
  async function read(path) {
    if (rows.length) await pause(1100);
    const started = now(); let data;
    const row = { request: path, status: "", elapsedMs: 0, note: "" };
    try {
      const response = await transport(new URL(path, origin), { method: "GET", signal: AbortSignal.timeout(120_000) });
      row.status = String(response.status);
      if (!response.ok) row.note = "요청 실패 · 서버 상태를 확인하세요";
      else data = await response.json();
    } catch { row.status = "실패"; row.note = "연결 또는 응답 시간 초과"; }
    row.elapsedMs = now() - started; rows.push(row);
    return data;
  }
  const backend = await read("/api/backend/status");
  if (backend) rows.at(-1).note = backend.results?.rank?.state === "available" ? "저장된 모델 결과 있음" : "저장된 모델 결과를 확인하세요";
  await read("/api/korean-market/indices");
  const briefing = await read("/api/briefing");
  if (briefing) {
    const absent = (briefing.macro?.indicators ?? []).filter(row => row.status !== "ok").length;
    rows.at(-1).note = `${briefing.status === "ready" ? "브리핑 준비됨" : "완료된 분석 없음"} · 지표 미제공 ${absent}개 · ${briefing.narrative?.status === "llm" ? "AI 요약" : "자동 생성 요약"}`;
    stocks = briefing.stocks ?? [];
  }
  rank = await read("/api/rank");
  const codes = Array.isArray(rank) && rank.length ? [...rank].sort((a, b) => Number(a.input_row?.pred_rank) - Number(b.input_row?.pred_rank)).map(row => row.input_row?.ticker) : stocks.map(row => row.code);
  const selected = [...new Set(codes)].filter(code => /^\d{6}$/.test(String(code))).slice(0, 5);
  for (const code of selected) {
    await read(`/api/korean-market/quote?symbol=${code}`);
    await read(`/api/korean-market/stock-chart?symbol=${code}&range=1M`);
  }
  if (selected.length) {
    const ready = await read("/api/briefing");
    if (ready) rows.at(-1).note = `가격 이력 준비 후 · 상관 ${ready.composition?.diversification?.status === "ready" ? "준비됨" : "준비 중"}`;
    const insight = await read(`/api/stock-insight?code=${selected[0]}`);
    if (insight) rows.at(-1).note = `나스닥 과거 통계 ${insight.sensitivity?.status === "ready" ? "준비됨" : "준비 중"}`;
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.table(await warmup(process.argv[2]));
}
