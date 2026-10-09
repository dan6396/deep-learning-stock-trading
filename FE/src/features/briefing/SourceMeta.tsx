import { SOURCE_LABELS, type DataSource } from "../../entities/source";
import { formatDate } from "../../shared/lib/format";

export function SourceMeta({ source, asOf, label = "기준 시각" }: { source: DataSource; asOf: string | null; label?: string }) {
  return <span className="briefing-source" data-source={source}>
    <span className="briefing-source-tag">{SOURCE_LABELS[source]}</span>
    <span>{label} {formatDate(asOf, true)}</span>
  </span>;
}
