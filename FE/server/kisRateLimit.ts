type Options = { now?: () => number; wait?: (milliseconds: number) => Promise<void> };

/** Capacity one prevents a burst when independent endpoints start together. */
export function createKisRequestLimiter({ now = Date.now, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }: Options = {}) {
  let availableAt = 0, queue: Promise<void> = Promise.resolve();
  return { take(rps: number): Promise<void> {
    const permit = queue.then(async () => {
      const delay = availableAt - now();
      if (delay > 0) await wait(delay);
      // Refill only one token; unused idle time never accumulates a burst.
      availableAt = now() + Math.ceil(1000 / rps);
    });
    queue = permit.catch(() => {});
    return permit;
  } };
}

export function kisMaxRps(env: Record<string, string | undefined>, mode: "real" | "mock"): number {
  const configured = Number(env.KIS_MAX_RPS);
  const ceiling = mode === "real" ? 18 : 1;
  return Number.isFinite(configured) && configured > 0 ? Math.max(0.1, Math.min(configured, ceiling)) : 1;
}

// Share one queue even if the dev server loads the module in more than one graph.
const processScope = globalThis as typeof globalThis & { __top5KisRequestLimiter?: ReturnType<typeof createKisRequestLimiter> };
export const kisRequestLimiter = processScope.__top5KisRequestLimiter ??= createKisRequestLimiter();
