import { stat, readFile } from "node:fs/promises";
const entries = new Map<string, { identity: string; value: unknown }>();
/** Atomic writers plus pre/post byte caps; unchanged mtime/size avoids parsing again. */
export async function readCachedJsonFile(path: string, limit = 1_048_576): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > limit) throw Error("cache_file_too_large");
  const identity = `${metadata.mtimeMs}:${metadata.size}:${metadata.ino}`, previous = entries.get(path);
  if (previous?.identity === identity) return previous.value;
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > limit) throw Error("cache_file_too_large");
  const value: unknown = JSON.parse(text);
  if (entries.size >= 8) entries.delete(entries.keys().next().value!);
  entries.set(path, { identity, value }); return value;
}
export function clearCachedJsonFiles(): void { entries.clear(); }
