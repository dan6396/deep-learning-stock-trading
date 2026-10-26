/** Keep opaque run references available without dominating the record. */
export function RunReference({ value }: { value: string | null | undefined }) {
  return value ? <details className="run-reference"><summary>실행 정보</summary><code>{value}</code></details> : null;
}
