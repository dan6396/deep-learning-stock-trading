const decode = (text: string) => text.replace(/&#(x[\da-f]+|\d+);/gi, (_all, token) => { const point = token[0].toLowerCase() === "x" ? parseInt(token.slice(1), 16) : Number(token); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_all, token) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[token as "amp"]);
function attributes(raw: string): Record<string, string> {
  const values: Record<string, string> = {}; let cursor = 0;
  while (cursor < raw.length) {
    while (cursor < raw.length && /[\s/]/.test(raw[cursor])) cursor++;
    const start = cursor; while (cursor < raw.length && !/[\s=/>]/.test(raw[cursor])) cursor++;
    const key = raw.slice(start, cursor).toLowerCase(); if (cursor === start) { cursor++; continue; }
    while (/\s/.test(raw[cursor] ?? "") && cursor < raw.length) cursor++;
    if (raw[cursor] !== "=") continue; cursor++;
    while (/\s/.test(raw[cursor] ?? "") && cursor < raw.length) cursor++;
    const quote = raw[cursor] === '"' || raw[cursor] === "'" ? raw[cursor++] : null, valueStart = cursor;
    if (quote) { while (cursor < raw.length && raw[cursor] !== quote) cursor++; }
    else { while (cursor < raw.length && !/[\s>]/.test(raw[cursor])) cursor++; }
    if (["id", "class", "type"].includes(key)) values[key] = raw.slice(valueStart, cursor);
    if (quote && raw[cursor] === quote) cursor++;
  }
  return values;
}
function articleBody(json: unknown): string {
  const pending = [json]; let best = "", visited = 0;
  while (pending.length && ++visited <= 4096) {
    const value = pending.pop();
    if (Array.isArray(value)) pending.push(...value);
    else if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (typeof row.articleBody === "string" && row.articleBody.length > best.length) best = row.articleBody;
      for (const child of Object.values(row)) if (child && typeof child === "object") pending.push(child);
    }
  }
  return best;
}
/** One forward HTML scan, bounded nesting/tags; malformed unclosed markup fails closed. */
function tokenize(html: string, captureAll = false, structuredEnabled = true): { text: string; structured: string } | null {
  // HTML tag names are ASCII. Unicode lowercasing (e.g. İ) can change offsets.
  const lower = html.replace(/[A-Z]/g, char => char.toLowerCase()), stack: { name: string; blocked: boolean; capture: boolean }[] = [], chunks: string[] = [];
  let cursor = 0, tags = 0, captured = captureAll, structured = "";
  const current = () => stack[stack.length - 1] ?? { capture: captureAll, blocked: false };
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor), endText = open < 0 ? html.length : open;
    if (current().capture && !current().blocked) chunks.push(html.slice(cursor, endText));
    if (open < 0) break;
    if (++tags > 12000) return null;
    if (html.startsWith("<!--", open)) { const close = html.indexOf("-->", open + 4); if (close < 0) return null; cursor = close + 3; continue; }
    let end = open + 1, quote = "";
    for (; end < html.length && end - open <= 8192; end++) { const char = html[end]; if (quote) { if (char === quote) quote = ""; } else if (char === '"' || char === "'") quote = char; else if (char === ">") break; }
    if (end >= html.length || end - open > 8192) return null;
    const raw = html.slice(open + 1, end).trim(), closing = raw.startsWith("/"), match = raw.match(/^\/?\s*([a-zA-Z][\w:-]*)/);
    cursor = end + 1; if (!match) continue;
    const name = match[1].toLowerCase();
    if (closing) { let index = stack.length - 1; while (index >= 0 && stack[index].name !== name) index--; if (index >= 0) { if (current().capture && !current().blocked && ["p", "div", "section", "article"].includes(name)) chunks.push("\n"); stack.length = index; } continue; }
    const attrs = attributes(raw.slice(match[0].length));
    if (["script", "style"].includes(name)) {
      const close = lower.indexOf("</" + name, cursor); if (close < 0) return null;
      if (structuredEnabled && name === "script" && attrs.type?.toLowerCase() === "application/ld+json") { try { const body = articleBody(JSON.parse(html.slice(cursor, close))); if (body.length > structured.length) structured = body; } catch { /* Invalid structured metadata is ignored. */ } }
      const closeEnd = html.indexOf(">", close); if (closeEnd < 0) return null; cursor = closeEnd + 1; continue;
    }
    const parent = current(), markers = (attrs.id ?? "") + " " + (attrs.class ?? "");
    const target = name === "article" || ["div", "section"].includes(name) && /article[-_]?body|article[-_]?view|news[-_]?view|news[-_]?body|article[-_]?text|newsct_article|dic_area/i.test(markers);
    const capture = parent.capture || !captured && target;
    if (!captured && target) captured = true;
    const blocked = parent.blocked || ["nav", "header", "footer", "aside", "form", "noscript", "svg"].includes(name) || /advert|\bad-|\bads\b|related|recommend|menu|copyright|social|share/i.test(markers);
    if (name === "br" && capture && !blocked) chunks.push("\n");
    if (!/\/$/.test(raw) && !["br", "img", "meta", "link", "input", "hr", "source", "area", "base", "embed", "wbr", "col", "track", "param"].includes(name)) { if (stack.length >= 256) return null; stack.push({ name, capture, blocked }); }
  }
  return { text: chunks.join(""), structured };
}
export function extractArticleText(html: string, maxLength = 2000): string | null {
  if (html.length > 1_000_000) return null;
  const scanned = tokenize(html); if (!scanned) return null;
  const raw = scanned.structured ? tokenize(scanned.structured, true, false)?.text : scanned.text;
  if (raw === undefined) return null;
  const text = decode(raw).replace(/[ \t\r]+/g, " ").split("\n").map(line => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length >= 100 ? text.slice(0, Math.min(2000, Math.max(0, maxLength))) : null;
}
