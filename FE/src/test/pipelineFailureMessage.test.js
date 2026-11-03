import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

vi.mock("node:child_process", () => { const mocks = { spawn: vi.fn() }; return { ...mocks, default: mocks }; });
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal();
  const mocks = { ...actual, access: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ isFile: () => true })), readFile: vi.fn(async () => "{}") };
  return { ...mocks, default: mocks };
});
vi.mock("../../server/briefing", () => ({ prepareCompletedResults: vi.fn(async () => {}), prepareRunBriefing: vi.fn() }));
vi.mock("../../server/runLedger", () => ({ beginRun: vi.fn(async () => {}), completeRun: vi.fn(), failRun: vi.fn(async () => {}) }));
vi.mock("../../server/pipelineFreshness", () => ({ pipelineProjectRoot: () => "fixture-root", pipelineOutputDir: () => "fixture-output", writePipelineRunMarker: vi.fn(async () => {}) }));

import { spawn } from "node:child_process";
import { createPipelineLogSanitizer, getCandidateAnalysisStatus, publicCandidateAnalysisError, sanitizePipelineLog, startCandidateAnalysis } from "../../server/pipelineRunner";

const banner = "[STEP 1] KOSPI200 후보 풀 로드 (목표 200개, 정렬/현재가 조회 없음)";

describe("publicCandidateAnalysisError", () => {
  it("classifies a failed child by its exception line, not by progress banners", () => {
    const log = ["Traceback (most recent call last):", '  File "integrated_pipeline.py", line 446, in run',
      "RuntimeError: KIS 지수 이력 수집 실패 (RuntimeError). MARKET_INDEX_SOURCE=kis 사용 시 KIS_ENV=mock 또는 real에 맞는 KIS 앱키·시크릿과 도메인 구성을 확인하세요.", banner, "  [시장 이력] market_index_source=kis"].join("\n");
    expect(publicCandidateAnalysisError(new Error(log))).toBe("KIS 지수 이력을 가져오지 못했습니다. 현재 모의·실전 환경에 맞는 KIS 인증 설정과 호출 한도를 확인한 뒤 다시 실행하세요.");
  });

  it("reads the pipeline's own [FATAL] line ahead of the banners that follow it", () => {
    const log = ["[FATAL] STEP 2 실패: KIS 지수 이력 수집 실패 (KIS index authentication failed: HTTP 403 EGW00133). MARKET_INDEX_SOURCE=kis 사용 시 ...", banner, "  [시장 이력] market_index_source=kis"].join("\n");
    expect(publicCandidateAnalysisError(new Error(log))).toContain("KIS 지수 이력을 가져오지 못했습니다");
  });

  it("falls back to the generic message when a banner is the only match", () => {
    const log = ["Traceback (most recent call last):", "ValueError: Index calendars disagree; refusing a mixed-date ranking", banner].join("\n");
    expect(publicCandidateAnalysisError(new Error(log))).toBe("AI 후보 분석 중 오류가 발생했습니다. 서버 콘솔에서 상세 로그를 확인하세요.");
  });

  it("classifies a KIS ReadTimeout as an index collection failure", () => {
    const log = ["[FATAL] STEP 2 실패: KIS 지수 이력 수집 실패 (KIS index 2001 2019-06-03..2026-10-30: request_or_response_failed: ReadTimeout after 3 attempts)", banner].join("\n");
    expect(publicCandidateAnalysisError(new Error(log))).toContain("KIS 지수 이력을 가져오지 못했습니다");
  });

  it("does not treat arbitrary provider timeouts as child process timeouts", () => {
    expect(publicCandidateAnalysisError(new Error("RuntimeError: provider timeout"))).toBe("AI 후보 분석 중 오류가 발생했습니다. 서버 콘솔에서 상세 로그를 확인하세요.");
  });

  it("keeps the single-line server messages", () => {
    expect(publicCandidateAnalysisError(new Error("AI candidate analysis timed out after 900000ms."))).toContain("시간이 초과");
    expect(publicCandidateAnalysisError(new Error("분석 시간이 초과되었습니다."))).toContain("시간이 초과");
    expect(publicCandidateAnalysisError(new Error("step2_all_transformer_rank.csv was not updated by this run"))).toContain("분석 결과 파일");
  });
});

describe("pipeline log redaction", () => {
  const login = "  로그인 ID: fixture-private-login";

  it("redacts every login line while preserving fatal and progress lines", () => {
    const log = `${login}\r\n${banner}\n로그인 ID: fixture-other-login\n[FATAL] STEP 2 실패`;
    const safe = sanitizePipelineLog(log);
    expect(safe).toBe(`  로그인 ID: ***\r\n${banner}\n로그인 ID: ***\n[FATAL] STEP 2 실패`);
    expect(safe).not.toContain("fixture-");
  });

  it("redacts login labels and values split at every possible chunk boundary", () => {
    const log = `${login}\n${banner}\n`;
    for (let split = 0; split <= log.length; split++) {
      const sanitize = createPipelineLogSanitizer();
      const first = sanitize(log.slice(0, split));
      const second = sanitize(log.slice(split));
      expect(first).not.toContain("fixture-");
      expect(second).not.toContain("fixture-");
      expect(first + second + sanitize("", true)).toBe(`  로그인 ID: ***\n${banner}\n`);
    }
  });

  it("redacts an unterminated final line and clears the pending buffer", () => {
    const sanitize = createPipelineLogSanitizer();
    expect(sanitize(login)).toBe("");
    expect(sanitize("", true)).toBe("  로그인 ID: ***");
    expect(sanitize("", true)).toBe("");
  });

  it("redacts stdout, stderr, failure tails and private errors without losing progress", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    spawn.mockReturnValueOnce(child);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      startCandidateAnalysis({});
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      // A login value longer than the retained tail must be redacted before truncation.
      child.stdout.emit("data", Buffer.from(`로그인 ID: fixture-${"x".repeat(7000)}\n`));
      const bytes = Buffer.from(`${login}\n[STEP 2] OHLCV\n`);
      for (let index = 0; index < bytes.length; index++) child.stdout.emit("data", bytes.subarray(index, index + 1));
      expect(getCandidateAnalysisStatus().progress.stageIndex).toBe(2);
      child.stderr.emit("data", Buffer.from("[FATAL] STEP 2 실패: KIS 지수 이력 수집 실패 (ReadTimeout)\n로그인 I"));
      child.stderr.emit("data", Buffer.from("D: fixture-stderr-login"));
      child.emit("close", 1);
      await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("failed"));
      const logged = [...stdout.mock.calls, ...stderr.mock.calls].flat().join("\n");
      expect(logged).toContain("로그인 ID: ***");
      expect(logged).toContain("Candidate analysis failed:");
      expect(logged).not.toContain("fixture-");
      expect(logged).not.toContain("x".repeat(100));
      const status = getCandidateAnalysisStatus();
      expect(status.progress.stageIndex).toBe(2);
      expect(status.error).toContain("KIS 지수 이력을 가져오지 못했습니다");
      expect(status.error).not.toContain("fixture-");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
