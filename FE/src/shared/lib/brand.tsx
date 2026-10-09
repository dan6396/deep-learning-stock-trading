/**
 * Single source of truth for the product name and mark. The brand is not
 * decided yet (docs/REBUILD_PLAN.md §9); change it here only.
 */
export const BRAND_NAME = "KOSPI AI Desk";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="8" fill="currentColor" />
      <path
        d="M6 19.5L11 14l4 3.5 7-9"
        fill="none"
        stroke="var(--ds-bg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
