import { usePageTitle } from "../hooks/usePageTitle";

/** Temporary page for routes whose screen arrives in a later milestone. */
export function PlaceholderPage({ title, milestone }: { title: string; milestone: string }) {
  usePageTitle(title);

  return (
    <section className="rounded-card bg-surface p-6" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title" className="m-0 text-2xl font-extrabold tracking-tight">
        {title}
      </h1>
      <p className="mt-2 mb-0 text-fg-2">이 화면은 리빌딩 {milestone} 단계에서 구현됩니다.</p>
    </section>
  );
}
