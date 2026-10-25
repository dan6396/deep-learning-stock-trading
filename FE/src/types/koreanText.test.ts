import { describe, expect, it } from "vitest";
import { koreanParticle } from "./koreanText";
describe("deterministic Korean particles", () => {
  it.each([["신한지주", "는", "가", "를"], ["한화오션", "은", "이", "을"], ["롯데정밀화학", "은", "이", "을"], ["ABC", "는", "가", "를"], ["SKM", "은", "이", "을"], ["ETF", "는", "가", "를"], ["GS", "는", "가", "를"], ["KTX", "는", "가", "를"], ["종목1", "은", "이", "을"], ["종목2", "는", "가", "를"], ["종목8", "은", "이", "을"], ["종목9", "는", "가", "를"]])("uses the final pronounced character for %s", (name, topic, subject, object) => {
    expect(koreanParticle(name)).toBe(name + topic); expect(koreanParticle(name, "이/가")).toBe(name + subject); expect(koreanParticle(name, "을/를")).toBe(name + object);
  });
});
