import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipelineOutputDir, pipelineProjectRoot, writePipelineRunMarker } from "./pipelineFreshness";
import { validateModelOnlyOutputs, parseCsv } from "./pipelineResults";
import { collectTopFiveArticles } from "./relatedNews";
import { randomUUID } from "node:crypto";
import { beginRun, completeRun, failRun } from "./runLedger";
import type { RunKind } from "../src/types/performance";

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

export type CandidateAnalysisRunResult = {
  runId?: string;
  kind?: RunKind;
  mode?: "model_only";
  modelSelectionRows?: number;
  candidateKind?: "not_produced";
  dashboardUpdated: boolean;
  elapsedMs: number;
  rows: number;
  /** The final model has no LLM reranking; always zero. */
  newsRows: number;
  articleCollectionStatus?: "collected" | "unavailable";
  status: "completed";
};

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_CHARS = 6000;

export type CandidateAnalysisProgress = {
  stage: string;
  stageCount: number;
  stageIndex: number;
  progressPercent: number;
  message: string;
  updatedAt: number;
};

const CANDIDATE_PROGRESS_STAGES = [
  "실행 준비",
  "KOSPI200 후보 풀 로드",
  "OHLCV 수집·앙상블 예측",
  "모델·수급 결과 확인",
  "뉴스 크롤링",
  "관련 기사 정리",
  "결과 파일 검증",
] as const;

let activeRun: Promise<CandidateAnalysisRunResult> | null = null;

function boundedPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function cleanLogLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function publicCandidateAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|시간이 초과/i.test(message)) {
    return "AI 후보 분석 시간이 초과되었습니다. 잠시 후 다시 실행하거나 서버 콘솔에서 병목 단계를 확인하세요.";
  }
  if (/not found|없음|not updated|찾지 못|결과 파일/i.test(message)) {
    return "분석 결과 파일을 확인하지 못했습니다. 서버 콘솔에서 파이프라인 실행 상태를 확인하세요.";
  }
  return "AI 후보 분석 중 오류가 발생했습니다. 서버 콘솔에서 상세 로그를 확인하세요.";
}

function progressSnapshot(
  stageIndex: number,
  progressPercent: number,
  message?: string,
  previous?: CandidateAnalysisProgress,
): CandidateAnalysisProgress {
  const safeStageIndex = Math.min(Math.max(stageIndex, 0), CANDIDATE_PROGRESS_STAGES.length - 1);
  return {
    message: message ?? CANDIDATE_PROGRESS_STAGES[safeStageIndex],
    progressPercent: boundedPercent(progressPercent),
    stage: CANDIDATE_PROGRESS_STAGES[safeStageIndex],
    stageCount: CANDIDATE_PROGRESS_STAGES.length,
    stageIndex: safeStageIndex,
    updatedAt: Date.now(),
  };
}

function initialProgress(): CandidateAnalysisProgress {
  return progressSnapshot(0, 3, "분석 작업을 준비하는 중입니다.");
}

function nextProgressFromLog(line: string, current: CandidateAnalysisProgress): CandidateAnalysisProgress {
  const log = cleanLogLine(line);
  let stageIndex = current.stageIndex;
  let progressPercent = current.progressPercent;
  let message = current.message;

  const advance = (nextStage: number, nextPercent: number, nextMessage: string) => {
    stageIndex = Math.max(stageIndex, nextStage);
    progressPercent = Math.max(progressPercent, nextPercent);
    message = nextMessage;
  };

  if (log.includes("[STEP 1]")) {
    advance(1, 12, "KOSPI200 후보 풀을 불러오는 중입니다.");
  } else if (log.includes("로드 완료")) {
    advance(1, 20, "KOSPI200 후보 풀 로드가 완료되었습니다.");
  } else if (log.includes("[STEP 2]")) {
    advance(2, 26, "OHLCV를 수집하고 앙상블 순위 점수를 계산하는 중입니다.");
  } else if (log.includes("[OHLCV 조회]")) {
    const ohlcvMatch = log.match(/OHLCV 조회\]\s*([0-9]+)\/([0-9]+)/);
    if (ohlcvMatch) {
      const current = Number(ohlcvMatch[1]);
      const total = Math.max(1, Number(ohlcvMatch[2]));
      const ohlcvProgress = 26 + Math.min(18, Math.round((current / total) * 18));
      advance(2, ohlcvProgress, `KOSPI200 OHLCV를 수집하는 중입니다. (${current}/${total})`);
    }
  } else if (log.includes("[Transformer 앙상블 예측]")) {
    advance(2, 46, "앙상블 배치 추론을 실행하는 중입니다.");
  } else if ((log.includes("예측수익률 예측 성공") || log.includes("모델 점수 예측 성공"))) {
    const countMatch = log.match(/(?:예측수익률|모델 점수) 예측 성공:\s*([0-9]+)\/([0-9]+)개/);
    advance(
      2,
      50,
      countMatch
        ? `앙상블 예측 완료: ${countMatch[1]}/${countMatch[2]}개 종목`
        : "앙상블 예측이 완료되었습니다.",
    );
  } else if (log.includes("[수급 조회]")) {
    const supplyMatch = log.match(/수급 조회\]\s*([0-9]+)\/([0-9]+)/);
    if (supplyMatch) {
      const current = Number(supplyMatch[1]);
      const total = Math.max(1, Number(supplyMatch[2]));
      const supplyProgress = 60 + Math.min(8, Math.round((current / total) * 8));
      advance(3, supplyProgress, `상위 후보의 외국인·기관 수급을 확인하는 중입니다. (${current}/${total})`);
    }
  } else if (log.includes("앙상블 최종")) {
    advance(3, 68, "수급 확인을 반영해 최종 후보를 구성하는 중입니다.");
  } else if (log.includes("[ALL DONE]")) {
    advance(3, 70, "모델 추론이 완료되었습니다. 관련 기사 수집을 준비합니다.");
  }

  return {
    ...progressSnapshot(stageIndex, progressPercent, message, current),
  };
}

function updateCandidateAnalysisProgress(
  updater: CandidateAnalysisProgress | ((current: CandidateAnalysisProgress) => CandidateAnalysisProgress),
): void {
  if (runState.status !== "running") {
    return;
  }

  const next = typeof updater === "function" ? updater(runState.progress) : updater;
  runState = { ...runState, progress: next };
}

function recordCandidateAnalysisOutput(text: string): void {
  const lines = text.split(/\r?\n/).map(cleanLogLine).filter(Boolean);
  for (const line of lines) {
    updateCandidateAnalysisProgress((current) => nextProgressFromLog(line, current));
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function projectRoot(env: Record<string, string | undefined>): string {
  return pipelineProjectRoot(env);
}

async function pythonExecutable(root: string, env: Record<string, string | undefined>): Promise<string> {
  if (env.PYTHON_EXECUTABLE) {
    return env.PYTHON_EXECUTABLE;
  }

  const candidates = [
    join(root, "venv", "Scripts", "python.exe"),
    join(root, ".venv", "Scripts", "python.exe"),
    "py",
    "python",
  ];

  for (const candidate of candidates.slice(0, -1)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

function optionalNumericArg(args: string[], name: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    args.push(name, String(Math.floor(parsed)));
  }
}

async function requireExistingFile(path: string, label: string): Promise<void> {
  if (!(await pathExists(path))) {
    throw new Error(`${label} not found: ${path}`);
  }
}

type PipelineInputs = {
  mainModulePath: string;
  predictModulePath: string;
  modelManifestPath: string;
};

function resolvePipelineInputs(root: string, env: Record<string, string | undefined>): PipelineInputs {
  return {
    mainModulePath: resolve(env.PIPELINE_MAIN_MODULE ?? join(root, "main.py")),
    predictModulePath: resolve(env.PIPELINE_PREDICT_MODULE ?? join(root, "predict.py")),
    modelManifestPath: resolve(env.PIPELINE_MODEL_MANIFEST ?? join(root, "models", "final_rank_ensemble", "manifest.json")),
  };
}

function pipelineInputArgs(inputs: PipelineInputs): string[] {
  return [
    "--main-module",
    inputs.mainModulePath,
    "--model-manifest",
    inputs.modelManifestPath,
    "--predict-module",
    inputs.predictModulePath,
  ];
}

function tail(value: string): string {
  return value.length > MAX_LOG_CHARS ? value.slice(value.length - MAX_LOG_CHARS) : value;
}

function pipelineEnv(env: Record<string, string | undefined>, modelOnly = false): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {
    ...env,
    PYTHONIOENCODING: env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: env.PYTHONUTF8 ?? "1",
    // Unbuffered stdout/stderr so per-stock progress streams live to the dev
    // console instead of arriving in one big buffered chunk at the end.
    PYTHONUNBUFFERED: env.PYTHONUNBUFFERED ?? "1",
  };
  const kisEnv = env.KIS_ENV === "real" ? "real" : "mock";
  const appKey =
    kisEnv === "real"
      ? env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY
      : env.KIS_MOCK_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY;
  const appSecret =
    kisEnv === "real"
      ? env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET
      : env.KIS_MOCK_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET;
  const openAiKey = env.OPENAI_API_KEY ?? env.OPEN_AI_KEY ?? env.OPEN_AI;

  if (appKey) {
    next.APP_KEY = appKey;
  }
  if (appSecret) {
    next.APP_SECRET = appSecret;
  }
  if (openAiKey) {
    next.OPENAI_API_KEY = openAiKey;
  }

  if (modelOnly) {
    for (const name of ["GEMINI_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "OPENAI_API_KEY", "OPEN_AI_KEY", "OPEN_AI"]) delete next[name];
  }
  return next;
}

function analysisMode(env: Record<string, string | undefined>): "model_only" {
  if (!env.PIPELINE_ANALYSIS_MODE) return "model_only";
  if (env.PIPELINE_ANALYSIS_MODE === "model_only") return "model_only";
  throw new Error("Unsupported analysis mode.");
}

async function preparePipelineInputs(inputs: PipelineInputs): Promise<PipelineInputs> {
  await requireExistingFile(inputs.mainModulePath, "Pipeline main module");
  await requireExistingFile(inputs.predictModulePath, "Pipeline predict module");
  await requireExistingFile(inputs.modelManifestPath, "Pipeline 앙상블 checkpoint");
  return inputs;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  onOutput?: (text: string) => void,
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = globalThis.setTimeout(() => {
      if (!settled) {
        child.kill("SIGTERM");
        settled = true;
        rejectRun(new Error(`AI candidate analysis timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = tail(stdout + text);
      onOutput?.(text);
      // Stream progress to the dev console so a long run isn't a silent black box.
      const trimmed = text.replace(/\s+$/, "");
      if (trimmed) {
        console.log(`[pipeline] ${trimmed}`);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = tail(stderr + text);
      onOutput?.(text);
      const trimmed = text.replace(/\s+$/, "");
      if (trimmed) {
        console.error(`[pipeline] ${trimmed}`);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      rejectRun(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);

      if (code === 0) {
        resolveRun();
        return;
      }

      const log = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      rejectRun(new Error(log || `AI candidate analysis exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function executeCandidateAnalysis(env = process.env, startedAt = Date.now(), identity = { runId: randomUUID(), kind: runKind(env) }): Promise<CandidateAnalysisRunResult> {
  await beginRun(identity.runId, identity.kind, analysisMode(env), startedAt, env);
  try {
    const result = await executeCandidatePipeline(env, startedAt, identity);
    const record = await completeRun(identity.runId, startedAt, env);
    await writePipelineRunMarker({ status: "completed", mode: analysisMode(env), ...identity, startedAt, finishedAt: Date.parse(record.finishedAt!), rows: result.rows, newsRows: result.newsRows }, env);
    return { ...result, ...identity };
  } catch (error) {
    await failRun(identity.runId, publicCandidateAnalysisError(error), env);
    await writePipelineRunMarker({ status: "failed", mode: analysisMode(env), ...identity, startedAt, finishedAt: Date.now(), error: publicCandidateAnalysisError(error) }, env);
    throw error;
  }
}
function runKind(env: Record<string, string | undefined>): RunKind {
  if (!env.PIPELINE_RUN_KIND || env.PIPELINE_RUN_KIND === "adhoc") return "adhoc";
  if (env.PIPELINE_RUN_KIND === "official") return "official";
  throw new Error("Unsupported run classification.");
}
async function executeCandidatePipeline(env: Record<string, string | undefined>, startedAt: number, identity: { runId: string; kind: RunKind }): Promise<CandidateAnalysisRunResult> {
  const mode = analysisMode(env), modelOnly = mode === "model_only";
  const marker = (value: Parameters<typeof writePipelineRunMarker>[0]) => writePipelineRunMarker({ ...value, ...identity }, env);
  const root = projectRoot(env);
  const scriptPath = join(root, "integrated_pipeline.py");
  const outputDir = pipelineOutputDir(env);
  const timeoutMs = Number(env.PIPELINE_RUN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const python = await pythonExecutable(root, env);

  updateCandidateAnalysisProgress(progressSnapshot(0, 5, "파이프라인 파일과 실행 환경을 확인하는 중입니다."));
  await requireExistingFile(scriptPath, "Pipeline script");
  await mkdir(outputDir, { recursive: true });
  await marker({ startedAt, status: "running", ...(modelOnly ? { mode } : {}) });

  try {
    const inputs = await preparePipelineInputs(resolvePipelineInputs(root, env));
    const args = [scriptPath, "--output-dir", outputDir, ...pipelineInputArgs(inputs)];

    optionalNumericArg(args, "--candidate-pool", env.PIPELINE_CANDIDATE_POOL);
    optionalNumericArg(args, "--final-max", env.PIPELINE_FINAL_MAX ?? env.PIPELINE_RUN_TOP);
    optionalNumericArg(args, "--ohlcv-lookback-days", env.PIPELINE_OHLCV_LOOKBACK_DAYS);
    optionalNumericArg(args, "--supply-window", env.PIPELINE_SUPPLY_WINDOW);
    optionalNumericArg(args, "--supply-min-positive-days", env.PIPELINE_SUPPLY_MIN_POSITIVE_DAYS);

    // Removing provider keys from the child env is not a barrier (the pipeline may fall back to a dotenv file),
    // so the only guarantee that no news/LLM step runs is that --run-news is absent.
    if (modelOnly && args.includes("--run-news")) throw new Error("Model-only analysis must not run the news step.");
    updateCandidateAnalysisProgress(progressSnapshot(0, 8, "integrated_pipeline.py 실행을 시작했습니다."));
    await runProcess(python, args, root, pipelineEnv(env, modelOnly), timeoutMs, recordCandidateAnalysisOutput);

    {
      updateCandidateAnalysisProgress(progressSnapshot(3, 90, "모델 원본 순위와 모델 선별 결과를 검증하는 중입니다."));
      const validated = await validateModelOnlyOutputs(outputDir, startedAt);
      updateCandidateAnalysisProgress(progressSnapshot(4, 94, "모델 TOP5의 관련 기사를 수집하는 중입니다."));
      let articleCollectionStatus: "collected" | "unavailable" = "unavailable";
      try {
        await collectTopFiveArticles(parseCsv(await readFile(join(outputDir, "step2_all_transformer_rank.csv"), "utf8")), outputDir, startedAt);
        articleCollectionStatus = "collected";
      } catch { /* Article/cache failure must never invalidate validated model predictions. */ }
      updateCandidateAnalysisProgress(progressSnapshot(5, 98, articleCollectionStatus === "collected" ? "관련 기사 수집 상태를 저장했습니다." : "기사 수집 기록 저장 실패 · 모델 결과를 유지합니다."));
      const result: CandidateAnalysisRunResult = { status: "completed", mode, candidateKind: "not_produced", dashboardUpdated: false,
        elapsedMs: Date.now() - startedAt, rows: validated.rows, modelSelectionRows: validated.modelSelectionRows, newsRows: 0, articleCollectionStatus };
      return result;
    }


  } catch (error) {
    throw error;
  }
}

/**
 * Status snapshot returned by `GET /api/candidates/run`. The run is async: a
 * single HTTP request can't survive the analysis (it takes minutes, and a
 * Cloudflare Tunnel cuts the origin off at ~100s with a 524). So POST starts the
 * job in the background and clients poll this status until it settles.
 */
export type CandidateAnalysisStatus = {
  runId?: string;
  kind?: RunKind;
  mode?: "model_only";
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: number;
  finishedAt?: number;
  elapsedMs?: number;
  progress?: CandidateAnalysisProgress;
  result?: CandidateAnalysisRunResult;
  error?: string;
};

type RunState =
  | { status: "idle" }
  | { status: "running"; startedAt: number; progress: CandidateAnalysisProgress }
  | { status: "completed"; startedAt: number; finishedAt: number; progress: CandidateAnalysisProgress; result: CandidateAnalysisRunResult }
  | { status: "failed"; startedAt: number; finishedAt: number; progress: CandidateAnalysisProgress; error: string };

let runState: RunState = { status: "idle" };
let runMode: "model_only" | undefined;
let runIdentity: { runId: string; kind: RunKind } | undefined;

/** Read-only connection diagnostics: no stale-run transition or marker writes. */
export function getCandidateAnalysisSnapshot(): { status: RunState["status"]; runId?: string; kind?: RunKind; startedAt?: number; finishedAt?: number } {
  return { status: runState.status, ...(runState.status !== "idle" ? { ...runIdentity, startedAt: runState.startedAt } : {}),
    ...(runState.status === "completed" || runState.status === "failed" ? { finishedAt: runState.finishedAt } : {}) };
}

function candidateProgressStaleMs(): number {
  const parsed = Number(process.env.PIPELINE_PROGRESS_STALE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

function failStaleCandidateRunIfNeeded(): void {
  if (runState.status !== "running") {
    return;
  }

  const staleMs = candidateProgressStaleMs();
  if (Date.now() - runState.progress.updatedAt < staleMs) {
    return;
  }

  const failedAt = Date.now();
  const startedAt = runState.startedAt;
  const error = "AI 후보 분석 진행 로그가 오래 갱신되지 않았습니다. 파이프라인 상태를 확인한 뒤 다시 실행하세요.";
  runState = {
    error,
    finishedAt: failedAt,
    progress: progressSnapshot(
      runState.progress.stageIndex,
      runState.progress.progressPercent,
      "분석 진행이 오래 갱신되지 않았습니다.",
      runState.progress,
    ),
    startedAt,
    status: "failed",
  };
  void writePipelineRunMarker({ error, finishedAt: failedAt, startedAt, status: "failed" }).catch(() => {});
}

export function getCandidateAnalysisStatus(): CandidateAnalysisStatus {
  failStaleCandidateRunIfNeeded();

  switch (runState.status) {
    case "running":
      return {
        mode: runMode,
        ...runIdentity,
        status: "running",
        startedAt: runState.startedAt,
        elapsedMs: Date.now() - runState.startedAt,
        progress: runState.progress,
      };
    case "completed":
      return {
        mode: runMode,
        ...runIdentity,
        status: "completed",
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
        elapsedMs: runState.finishedAt - runState.startedAt,
        progress: runState.progress,
        result: runState.result,
      };
    case "failed":
      return {
        mode: runMode,
        ...runIdentity,
        status: "failed",
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
        elapsedMs: runState.finishedAt - runState.startedAt,
        progress: runState.progress,
        error: runState.error,
      };
    default:
      return { status: "idle" };
  }
}

/**
 * Starts the analysis in the background (or attaches to the in-flight run) and
 * returns the current status immediately, so the HTTP request never blocks long
 * enough to hit the tunnel's gateway timeout. Poll {@link getCandidateAnalysisStatus}.
 */
export function startCandidateAnalysis(env = process.env): CandidateAnalysisStatus {
  const mode = analysisMode(env);
  const kind = runKind(env);
  if (!activeRun) {
    runMode = mode;
    const startedAt = Date.now();
    runIdentity = { runId: randomUUID(), kind };
    runState = { status: "running", startedAt, progress: initialProgress() };

    activeRun = executeCandidateAnalysis(env, startedAt, runIdentity);
    activeRun
      .then((result) => {
        const progress =
          runState.status === "running"
            ? progressSnapshot(6, 100, "분석이 완료되었습니다.", runState.progress)
            : progressSnapshot(6, 100, "분석이 완료되었습니다.");
        runState = { status: "completed", startedAt, finishedAt: Date.now(), progress, result };
      })
      .catch((error: unknown) => {
        const privateMessage = error instanceof Error ? error.message : String(error);
        const publicMessage = publicCandidateAnalysisError(error);
        console.error(`[pipeline] Candidate analysis failed: ${privateMessage}`);
        const progress =
          runState.status === "running"
            ? progressSnapshot(runState.progress.stageIndex, runState.progress.progressPercent, "분석 중 오류가 발생했습니다.", runState.progress)
            : progressSnapshot(0, 0, "분석 중 오류가 발생했습니다.");
        runState = {
          status: "failed",
          startedAt,
          finishedAt: Date.now(),
          progress,
          error: publicMessage,
        };
      })
      .finally(() => {
        activeRun = null;
      });
  }

  return getCandidateAnalysisStatus();
}

/**
 * Backwards-compatible blocking variant: starts the run if needed and awaits it.
 * Prefer {@link startCandidateAnalysis} + polling for anything fronted by a proxy
 * or tunnel that enforces a request timeout.
 */
export async function runCandidateAnalysis(env = process.env): Promise<CandidateAnalysisRunResult> {
  if (!activeRun) {
    activeRun = executeCandidateAnalysis(env).finally(() => {
      activeRun = null;
    });
  }

  return activeRun;
}
