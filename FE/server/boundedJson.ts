/** Bounded UTF-8 response reader. Never include provider response text in errors. */
export async function readBoundedJson(response: Response, limit = 1_048_576): Promise<any> {
  const length = Number(response.headers?.get("content-length"));
  if (Number.isFinite(length) && length > limit) { await response.body?.cancel(); throw new Error("Response too large."); }
  if (!response.body) {
    // Test/provider adapters without streams still receive a post-parse bound.
    const value = await response.json();
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit) throw new Error("Response too large.");
    return value;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error("Response too large."); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
