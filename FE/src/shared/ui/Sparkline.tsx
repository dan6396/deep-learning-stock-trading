export type SparklinePoint = { timestamp: number; price: number };
/** Pure rendering: callers own acquisition, validation and gap boundaries. */
export function Sparkline({ segments, label, className, color = "currentColor", width = 120, height = 32 }: {
  segments: readonly (readonly SparklinePoint[])[]; label: string; className?: string; color?: string; width?: number; height?: number;
}) {
  const valid = segments.map(segment => segment.filter(p => Number.isFinite(p.timestamp) && Number.isFinite(p.price))).filter(s => s.length);
  const points = valid.flat();
  if (!points.length) return null;
  const min = Math.min(...points.map(p => p.price)), max = Math.max(...points.map(p => p.price)), span = max - min || 1;
  const first = Math.min(...points.map(p => p.timestamp)), last = Math.max(...points.map(p => p.timestamp)), timeSpan = last - first || 1;
  const paths = valid.map(segment => {
    const coords = segment.map(p => `${Number(((p.timestamp - first) / timeSpan * width).toFixed(1))},${Number((3 + (1 - (p.price - min) / span) * (height - 6)).toFixed(1))}`);
    return segment.length === 1 ? `M ${coords[0]} L ${coords[0]}` : `M ${coords.join(" L ")}`;
  });
  return <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <path d={paths.join(" ")} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
