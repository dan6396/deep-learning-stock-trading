import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AboutPage } from "./AboutPage";
import { ABOUT_SECTIONS } from "./AboutContent";
import { MODEL_SUMMARY } from "../../entities/model";

it.each(["/about", "/next/about"])("keeps introduction links and evidence honest at %s", path => {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AboutPage /></MemoryRouter>);
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(ABOUT_SECTIONS.length + 1);
  expect(screen.getByText(/공식·수시 실행 구분/)).toBeInTheDocument();
  expect(screen.getByText(/일치도는 승률이나 수익 확률이 아닙니다/)).toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.startsWith(MODEL_SUMMARY) === true)).toHaveTextContent("OHLCV 파생 5개, RSI 1개, MACD 2개, 볼린저 밴드 3개");
  expect(screen.getByRole("heading", { name: "Transformer Ensemble → 순위 → Top-5" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "브리핑 보기" })).toHaveAttribute("href", path.startsWith("/next/") ? "/next" : "/");
  expect(screen.getByRole("link", { name: "전체 순위 확인" })).toHaveAttribute("href", path.startsWith("/next/") ? "/next/rank" : "/rank");
});
