import { useEffect } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAppPaths } from "../app/paths";
import "./notFound.css";

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
    <section className="not-found" aria-labelledby="not-found-title">
      <p className="not-found-code">404</p>
      <h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
      <p className="not-found-text">요청하신 주소가 변경되었거나 더 이상 존재하지 않습니다.</p>
      <Link className="not-found-link" to={paths.briefing}>
        브리핑으로 돌아가기
      </Link>
    </section>
  );
}
