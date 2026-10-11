export function safeArticleUrl(value: string | null | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try { const url = new URL(value); return url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; }
}
