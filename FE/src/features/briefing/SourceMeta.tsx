import { SOURCE_LABELS, type DataSource } from "../../entities/source";
import { formatDate } from "../../shared/lib/format";

export function SourceMeta({ source, asOf, label = "기준 시각" }: { source: DataSource; asOf: string | null; label?: string }) {
  if (!asOf && source !== "sample") return null;
  return <span className="briefing-source" data-source={source} aria-label={`${SOURCE_LABELS[source]} · ${label}${asOf ? ` ${formatDate(asOf, true)}` : ""}`}>
    {source === "sample" && <span className="briefing-source-tag">{SOURCE_LABELS[source]}</span>}
    <span title={SOURCE_LABELS[source]}>{label}{asOf ? ` ${formatDate(asOf, true)}` : ""}</span>
  </span>;
}
