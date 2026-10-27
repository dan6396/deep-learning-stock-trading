import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sparkline } from "./Sparkline";
describe("pure Sparkline", () => {
  it("keeps gap segments distinct with finite coordinates and preserves its accessible label", () => {
    render(<Sparkline segments={[[{ timestamp: 1, price: 100 }], [{ timestamp: 3, price: 110 }, { timestamp: 4, price: 105 }]]} label="5일 관측" />);
    expect(screen.getByRole("img", { name: "5일 관측" })).toHaveAttribute("preserveAspectRatio", "none");
    expect(document.querySelector("path")).toHaveAttribute("vector-effect", "non-scaling-stroke");
    const d = document.querySelector("path")!.getAttribute("d")!;
    expect(d.match(/M /g)).toHaveLength(2); expect(d).not.toMatch(/NaN|Infinity/);
  });
  it("keeps the TOP5 coordinate geometry when using custom dimensions", () => {
    render(<Sparkline segments={[[{ timestamp: 1, price: 100 }, { timestamp: 2, price: 110 }]]} width={120} height={32} label="TOP5" />);
    expect(document.querySelector("path")).toHaveAttribute("d", "M 0,29 L 120,3");
  });
  it("does not invent a line for an empty series", () => {
    render(<Sparkline segments={[]} label="자료 없음" />); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
