import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PastObservationTag } from "./PastObservationTag";
afterEach(() => vi.useRealTimers());
describe("neutral past-observation badge", () => {
  it("shows an old timestamp using neutral styling but hides a fresh completed Friday on Sunday", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00+09:00"));
    const { rerender } = render(<PastObservationTag asOf="2026-10-22T16:00:00+09:00" />);
    expect(screen.getByText(/지난 관측 · 기준 시각/)).toHaveClass("past-observation-tag");
    rerender(<PastObservationTag asOf="2026-10-23T15:30:00+09:00" />); expect(screen.queryByText(/지난 관측/)).not.toBeInTheDocument();
  });
});
