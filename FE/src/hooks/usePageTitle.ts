import { useEffect } from "react";
import { BRAND_NAME } from "../shared/lib/brand";

const BASE_TITLE = `${BRAND_NAME} · AI 자동매매 의사결정 보조`;

/**
 * Sets the document title for the current route and restores the base title on
 * unmount, so SPA navigation keeps the browser tab/history readable.
 */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND_NAME}` : BASE_TITLE;

    return () => {
      document.title = BASE_TITLE;
    };
  }, [title]);
}
