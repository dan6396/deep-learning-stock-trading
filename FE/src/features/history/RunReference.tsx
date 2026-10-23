/** Keep opaque run references available without dominating the record. */
export function RunReference({ value }: { value: string | null | undefined }) {
  return value ? <details className="run-reference"><summary>실행 기록 {value.slice(0, 8)}</summary><code>{value}</code></details> : <span>기록 번호 없음</span>;
}
