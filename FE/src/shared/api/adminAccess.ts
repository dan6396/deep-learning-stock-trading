import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kospi-admin-token.v1";
const EVENT = "kospi-admin-token-change";
export function getAdminToken(): string {
  try { return window.sessionStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
}
export function setAdminToken(token: string): void {
  try {
    if (token.trim()) window.sessionStorage.setItem(STORAGE_KEY, token.trim());
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { throw new Error("세션 저장소를 사용할 수 없습니다. 브라우저 설정을 확인해 주세요."); }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener); window.addEventListener("storage", listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", listener); };
}
export function useAdminAccess(): boolean { return Boolean(useSyncExternalStore(subscribe, getAdminToken, () => "")); }

export class ApiRequestError extends Error {
  constructor(public status: number, public retryAfter: string | null = null, conflictKind?: unknown) {
    super(status === 401 ? "관리자 인증이 필요합니다."
      : status === 403 ? "이 작업은 허용되지 않습니다. 공식 실행은 예약 작업 전용이므로 수시 실행으로 요청해 주세요."
      : status === 409 ? `다른 분석${conflictKind === "official" ? "(공식 예약 실행)" : conflictKind === "adhoc" ? "(관리자 수시 실행)" : ""}이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.`
      : status === 429 ? `요청 한도를 초과했습니다. ${retryAfter && /^\d+$/.test(retryAfter) ? retryAfter + "초" : "잠시"} 후 다시 시도해 주세요.`
      : `요청 실패 (${status})`);
  }
}
