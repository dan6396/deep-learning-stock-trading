import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { adaptStockInsight } from "../../entities/stockInsight";

export function useStockInsight(code: string) {
  return useQuery({ queryKey: ["stock-insight", code], queryFn: async ({ signal }) => {
    const result = await apiClient.request(`/api/stock-insight?code=${code}`, { signal });
    return adaptStockInsight(result.data, code);
  }, staleTime: 60_000, retry: false, refetchInterval: query => query.state.data?.sensitivity.status === "preparing" ? 30_000 : false });
}
