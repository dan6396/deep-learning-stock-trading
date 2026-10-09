import { record, textValue } from "./value";

export type DataSource = "live" | "cache" | "sample" | "unknown";
export type DataResult<T> = { data: T; source: DataSource; asOf: string | null };
export const SOURCE_LABELS: Record<DataSource, string> = {
  live: "API 조회", cache: "저장된 결과", sample: "예시 데이터", unknown: "출처 미확인",
};

export function dataSource(value: unknown): DataSource {
  return value === "live" || value === "cache" || value === "sample" ? value : "unknown";
}

export function aggregateSource(sources: readonly DataSource[]): DataSource {
  return sources.includes("sample") ? "sample" : sources.includes("unknown") ? "unknown" : sources.includes("cache") ? "cache" : sources.length ? "live" : "unknown";
}

export function timestamp(value: unknown): string | null {
  const text = textValue(value);
  return text && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text) && Number.isFinite(Date.parse(text)) ? text : null;
}

/** Payload evidence takes precedence over transport success or optimistic headers. */
export function resultMeta(value: unknown, fallback?: Partial<DataResult<unknown>>): Omit<DataResult<never>, "data"> {
  const object = record(value);
  const meta = record(object.data_meta);
  const source = object.isSample === true ? "sample" : dataSource(meta.source ?? object.source ?? fallback?.source);
  return { source, asOf: timestamp(meta.asOf ?? object.asOf ?? object.generatedAt ?? fallback?.asOf) };
}
