import { useEffect } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAppPaths } from "../app/paths";

export function NotFoundPage() {
  usePageTitle("페이지를 찾을 수 없습니다");
  const paths = useAppPaths();
  useEffect(() => {
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const meta = existing ?? document.createElement("meta");
    const previousContent = meta.getAttribute("content");
    meta.name = "robots";
    meta.content = "noindex";
    if (!existing) document.head.append(meta);
    return () => {
      if (!existing) meta.remove();
      else if (previousContent === null) meta.removeAttribute("content");
      else meta.content = previousContent;
    };
  }, []);

  return (
    <section className="mx-auto max-w-2xl rounded-card bg-surface p-8 my-10">
      <div className="grid gap-5">
        <p className="eyebrow">
          <span aria-hidden="true" />
          404
        </p>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p>요청하신 주소가 변경되었거나 더 이상 존재하지 않습니다.</p>
        <Link className="text-link min-h-10 inline-flex items-center" to={paths.briefing}>
          브리핑으로 돌아가기
        </Link>
      </div>
    </section>
  );
}
