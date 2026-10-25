import { aggregateSource, dataSource, resultMeta, type DataResult, type DataSource } from "../../entities/source";
import { record } from "../../entities/value";
import { ApiRequestError, getAdminToken } from "./adminAccess";

const DEFAULT_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl = DEFAULT_BASE_URL, fetcher: typeof fetch = (...args) => fetch(...args)) {
  async function request(path: string, options: { signal?: AbortSignal; method?: "GET" | "POST"; timeoutMs?: number; fallbackSource?: DataSource } = {}): Promise<DataResult<unknown>> {
    const controller = new AbortController();
    const forward = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forward(); else options.signal?.addEventListener("abort", forward, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException("요청 시간이 초과되었습니다.", "TimeoutError")), options.timeoutMs ?? 15000);
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      const token = options.method === "POST" ? getAdminToken() : "";
      const response = await fetcher(`${baseUrl}${path}`, { method: options.method ?? "GET", signal: controller.signal, ...(token ? { redirect: "error" as const } : {}), headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!response.ok) {
        let conflictKind: unknown;
        if (response.status === 409) {
          // Display only recognized public metadata; never render arbitrary server errors.
          try { conflictKind = record(await response.json()).kind; } catch { /* Generic conflict guidance remains available. */ }
          if (controller.signal.aborted) throw controller.signal.reason;
        }
        throw new ApiRequestError(response.status, response.headers.get("Retry-After"), conflictKind);
      }
      if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`JSON 응답이 아닙니다: ${path}`);
      const payload: unknown = await response.json();
      if (controller.signal.aborted) throw controller.signal.reason;
      const envelope = record(payload);
      const wrapped = Object.prototype.hasOwnProperty.call(envelope, "data") && Object.prototype.hasOwnProperty.call(envelope, "source");
      const data = wrapped ? envelope.data : payload;
      const meta = resultMeta(wrapped ? envelope : payload, {
        source: (response.headers.get("x-data-source") ?? options.fallbackSource) as DataSource | undefined,
        asOf: response.headers.get("x-data-as-of"),
      });
      const headerSource = response.headers.get("x-data-source");
      return { data, ...meta, source: headerSource === null ? meta.source : aggregateSource([meta.source, dataSource(headerSource)]) };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", forward);
    }
  }
  return { request };
}
export const apiClient = createApiClient();
