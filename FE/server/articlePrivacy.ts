import { createHash } from "node:crypto";
import type { BriefingInput } from "./briefing";
export function articleBodyHashes(input: BriefingInput): Record<string, string> {
  return input.articleBodies === undefined ? input.articleBodyHashes ?? {} : Object.fromEntries(Object.entries(input.articleBodies).map(([id, body]) => [id, createHash("sha256").update(body.text).digest("hex")]));
}
/** A fixed-size substring index avoids both long verbatim copies and quadratic scans. */
export function removeArticlePassages(value: unknown, input: BriefingInput): unknown {
  const passages = new Set<string>(), normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ");
  for (const body of Object.values(input.articleBodies ?? {})) { const text = normalize(body.text); for (let index = 0; index + 80 <= text.length; index++) passages.add(text.slice(index, index + 80)); }
  if (!passages.size) return value;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") { const text = normalize(node); for (let index = 0; index + 80 <= text.length; index++) if (passages.has(text.slice(index, index + 80))) return ""; return node; }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value);
}
