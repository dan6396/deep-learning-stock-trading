import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportChart } from "./ReportChart";
import { adaptChart } from "../../entities/market";
import { chartBundle } from "../../test/fixtures/reportFixtures";
import { queryKeys } from "../../shared/api/queries";

afterEach(() => vi.unstubAllGlobals());
it("shows the default 5-minute interval only for intraday candles without another API request", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const bundle = chartBundle();
  for (const range of ["1D", "1M", "3M", "1Y", "3Y", "5Y"] as const) client.setQueryData(queryKeys.chart("005930", range), adaptChart(bundle, "005930", range));
  const { unmount } = render(<QueryClientProvider client={client}><ReportChart code="005930" /></QueryClientProvider>);
  expect(screen.queryByRole("group", { name: "봉 간격" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "캔들" }));
  expect(screen.getByRole("button", { name: "5분" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "15분" }));
  expect(screen.getByRole("button", { name: "15분" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "30분" }));
  expect(screen.getByRole("button", { name: "30분" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "5년" }));
  expect(screen.queryByRole("group", { name: "봉 간격" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "1일" }));
  expect(screen.getByRole("button", { name: "5분" })).toHaveAttribute("aria-pressed", "true");
  expect(fetcher).not.toHaveBeenCalled();
  unmount(); client.clear();
});
