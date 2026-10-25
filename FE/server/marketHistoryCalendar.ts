import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipelineProjectRoot } from "./pipelineFreshness";
import { nextKrxSession } from "./krxCalendar";

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
function tableDates(startAfter: string, end: string) {
  const dates: string[] = [];
  let cursor = startAfter;
  for (let count = 0; count < 2000; count++) {
    const next = nextKrxSession(cursor);
    if (!next) return { dates, confirmed: false };
    if (next > end) return { dates, confirmed: true };
    dates.push(next); cursor = next;
  }
  return { dates, confirmed: false };
}

/** Public KIS KOSPI history is the session reference, never a synthetic weekday calendar. */
export async function marketHistorySessions(start: string, end: string) {
  try {
    const text = await readFile(join(pipelineProjectRoot(), "outputs", "market_index_history", "KOSPI.csv"), "utf8");
    if (text.length > 4_000_000) throw new Error("Oversized session reference.");
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/), header = lines.shift()?.split(",");
    if (header?.join(",") !== "date,Close,Volume,source,collected_at") throw new Error("Invalid session reference.");
    const dates: string[] = [];
    for (const line of lines) {
      const [date, close, volume, source, observed] = line.split(",");
      if (!validDate(date) || !close || !volume || !Number.isFinite(Number(close)) || Number(close) <= 0
        || !Number.isFinite(Number(volume)) || Number(volume) <= 0 || source !== "kis" || !Number.isFinite(Date.parse(observed))
        || dates.length > 0 && dates[dates.length - 1] >= date) throw new Error("Invalid session reference row.");
      dates.push(date);
    }
    if (dates.length && dates[0] <= start) {
      const last = dates[dates.length - 1];
      const tail = last < end ? tableDates(last, end) : { dates: [], confirmed: true };
      return { dates: [...dates.filter(date => date >= start && date <= end), ...tail.dates], confirmed: tail.confirmed, source: "kis-index-cache" as const };
    }
  } catch { /* Missing/corrupt/foreign-source history falls back to the covered KRX table. */ }
  const previous = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10);
  return { ...tableDates(previous, end), source: "krx-table" as const };
}
