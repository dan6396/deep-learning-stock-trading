import { useContext, useEffect, useSyncExternalStore } from "react";
import { notifyManager, QueryClientContext } from "@tanstack/react-query";
import { queries, queryKeys } from "./queries";
import { getAdminToken, subscribeAdminToken } from "./adminSession";
import type { BackendStatus } from "../../types/backendStatus";
export { ApiRequestError, getAdminToken, setAdminToken } from "./adminSession";

export function useStoredAdminToken(): string {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, () => "");
}
export function isLocalDevHost(hostname: string): boolean {
  return import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
const noSubscription = () => () => {};
export function useLocalWriteAllowed(): boolean {
  const client = useContext(QueryClientContext);
  const local = typeof window !== "undefined" && isLocalDevHost(window.location.hostname);
  useEffect(() => {
    if (local && client) void client.fetchQuery(queries.backendStatus()).catch(() => {});
  }, [local, client]);
  return useSyncExternalStore(
    // Query observers can emit cache events while another component renders.
    // Match React Query's own deferred subscription notifications.
    client ? listener => client.getQueryCache().subscribe(notifyManager.batchCalls(listener)) : noSubscription,
    () => Boolean(local && client?.getQueryData<BackendStatus>(queryKeys.backendStatus())?.localWriteAllowed === true),
    () => false,
  );
}
export function useAdminAccess(): boolean {
  const token = useStoredAdminToken(), local = useLocalWriteAllowed();
  return Boolean(token || local);
}
