import { createHash } from "node:crypto";

/** Scope private maps without keeping credential strings in their keys. */
export const inFlightKey = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** Only the upstream operation owns cancellation; each waiter receives its own data. */
export function shareInFlight<T>(pending: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let shared = pending.get(key);
  if (!shared) {
    shared = Promise.resolve().then(load);
    pending.set(key, shared);
    const cleanup = () => { if (pending.get(key) === shared) pending.delete(key); };
    void shared.then(cleanup, cleanup);
  }
  return shared.then(value => structuredClone(value));
}
