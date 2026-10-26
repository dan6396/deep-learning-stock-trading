import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AboutPage } from "./AboutPage";
import { ABOUT_DESCRIPTION, ABOUT_SECTIONS, AboutContent } from "./AboutContent";
import { expectReadableUserText } from "../../test/assertUserText";

it.each(["/about", "/next/about"])("explains the current service and preserves navigation at %s", path => {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AboutPage /></MemoryRouter>);
  const base = path.startsWith("/next/") ? "/next" : "";
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["무엇을 하나", "어떻게 읽나", "한계"]);
  expect(screen.getByRole("link", { name: "브리핑 보기" })).toHaveAttribute("href", base || "/");
  expect(screen.getByRole("link", { name: "전체 순위" })).toHaveAttribute("href", `${base}/rank`);
  expect(screen.getByRole("link", { name: "분석 기록" })).toHaveAttribute("href", `${base}/history`);
  expect(screen.getAllByRole("link")).toHaveLength(3);
  const guide = document.getElementById("analysis-guide");
  expect(guide).toHaveTextContent("상단에 ‘AI 분석 실행’ 버튼이 보이면 새 분석을 시작할 수 있습니다.");
  expect(guide).toHaveTextContent("순위와 요약이 자동 갱신");
  expect(guide).toHaveTextContent("요약 생성에 실패하면 대체 문장");
  expectReadableUserText(document.querySelector(".about-page")!);
});

it("distinguishes model inputs, prices, verified performance and missing news", () => {
  render(<AboutContent />);
  expect(screen.getByRole("img", { name: /20일 모델과 120일 모델의 순위를 결합해 TOP5/ })).toBeInTheDocument();
  expect(document.body).toHaveTextContent("기간별 3개 seed 평균 후 50:50");
  expect(document.body).toHaveTextContent("다음 거래일 시가→종가의 상대 순위");
  expect(document.body).toHaveTextContent("20일·120일은 예측 기간이 아니라");
  expect(document.body).toHaveTextContent("현재가·등락은 가격 정보이고, 순위 점수는 모델의 비교 값");
  expect(document.body).toHaveTextContent("공식 성과는 분석 시각·가격 자료 검증을 통과한 기록만 집계");
  expect(document.body).toHaveTextContent("순위 점수는 수익률이나 상승 확률이 아닙니다");
  expect(document.body).toHaveTextContent("뉴스 미수집은 수집 결과 0건과 다릅니다");
  expect(document.body).toHaveTextContent("예시·보간 데이터는 실제 관측값과 구분해 읽으세요");
  expect(document.body).toHaveTextContent("실제 주문 손익이 아닙니다");
  expect(document.body).not.toHaveTextContent(/약 40초|최신 실행 상태만|성과는 확인되지|공개 예정/);
});

it("keeps static content and metadata available without a router or browser effects", () => {
  const markup = renderToStaticMarkup(<AboutContent />);
  expect(ABOUT_DESCRIPTION).toContain("실제 가격 기반 성과");
  expect(ABOUT_SECTIONS.map(section => section.title)).toEqual(["무엇을 하나", "어떻게 읽나", "한계"]);
  expect(markup).toContain('href="/"');
  expect(markup).toContain('href="/rank"');
  expect(markup).toContain('href="/history"');
  expect(markup).toContain('id="analysis-guide"');
  expect(markup).not.toContain("<script");
});
