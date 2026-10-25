import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
const html = readFileSync("index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let themeColor;
beforeEach(() => {
  themeColor = document.createElement("meta");
  themeColor.name = "theme-color";
  themeColor.content = "#000000";
  document.head.append(themeColor);
});
afterEach(() => themeColor.remove());
describe("pre-paint theme bootstrap", () => {
  it.each(["light", "dark", null, "invalid"])("applies a safe initial theme for %s", value => {
    new Function("document", "localStorage", script)(document, { getItem: () => value });
    expect(document.documentElement.dataset.theme).toBe(value === "light" ? "light" : "dark");
    expect(document.documentElement.style.backgroundColor).toBe(value === "light" ? "rgb(242, 244, 246)" : "rgb(23, 23, 28)");
    expect(themeColor.content).toBe(value === "light" ? "#f2f4f6" : "#17171c");
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('<div id="root">'));
  });
  it("defaults to dark when browser storage is unavailable", () => {
    new Function("document", "localStorage", script)(document, { getItem: () => { throw new Error("unavailable"); } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(themeColor.content).toBe("#17171c");
  });
});
