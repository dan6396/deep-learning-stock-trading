type Options = { now?: () => number; wait?: (milliseconds: number) => Promise<void> };
export type KisPriority = "user" | "background";
export const kisRequestMetrics = { user: 0, background: 0, rateLimitErrors: 0 };

/** Capacity one prevents a burst when independent endpoints start together. */
export function createKisRequestLimiter({ now = Date.now, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }: Options = {}) {
  type Ticket = { rps: number; key?: string; resolve(): void; reject(error: unknown): void };
  const user: Ticket[] = [], background: Ticket[] = [];
  const promoted = new Set<string>();
  let availableAt = 0, backgroundAt = 0, running = false;
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (user.length || background.length) {
        const lane = user.length ? user : background;
        const delay = Math.max(availableAt, lane === background ? backgroundAt : 0) - now();
        if (delay > 0) {
          try { await wait(Math.min(delay, 1000)); }
          catch (error) { lane.shift()?.reject(error); }
          continue; // Re-select after waiting: a newly arrived user always gets the next slot.
        }
        const ticket = lane.shift()!;
        availableAt = now() + Math.ceil(1000 / ticket.rps);
        if (lane === background) backgroundAt = now() + 2000; // <= 30 background calls/minute.
        ticket.resolve();
        await Promise.resolve();
      }
    } finally { running = false; }
  }
  return { take(rps: number, priority: KisPriority = "user", key?: string): Promise<void> {
    const lane = priority === "background" && !(key && promoted.has(key)) ? background : user;
    const permit = new Promise<void>((resolve, reject) => lane.push({ rps, key, resolve, reject }));
    void Promise.resolve().then(pump);
    return permit;
  }, promote(key: string) {
    promoted.add(key);
    for (let index = 0; index < background.length;) {
      if (background[index].key === key) user.push(...background.splice(index, 1)); else index++;
    }
  }, release(key: string) { promoted.delete(key); },
  priority(key: string | undefined, fallback: KisPriority): KisPriority { return key && promoted.has(key) ? "user" : fallback; } };
}

export function kisMaxRps(env: Record<string, string | undefined>, mode: "real" | "mock"): number {
  const configured = Number(env.KIS_MAX_RPS);
  const ceiling = mode === "real" ? 18 : 1;
  return Number.isFinite(configured) && configured > 0 ? Math.max(0.1, Math.min(configured, ceiling)) : 1;
}

// Share one queue even if the dev server loads the module in more than one graph.
const processScope = globalThis as typeof globalThis & { __top5KisRequestLimiter?: ReturnType<typeof createKisRequestLimiter> };
export const kisRequestLimiter = processScope.__top5KisRequestLimiter ??= createKisRequestLimiter();
