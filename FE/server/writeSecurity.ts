import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import type { ApiRequest } from "./routes";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) { super(message); }
}

export function validateDevelopmentAccess(env: Record<string, string | undefined>): void {
  const hosts = env.DEV_ALLOWED_HOSTS?.split(",").some(host => host.trim());
  if (hosts && !env.ADMIN_API_TOKEN?.trim() && !env.CRON_SECRET?.trim()) {
    throw new Error("DEV_ALLOWED_HOSTS requires ADMIN_API_TOKEN or CRON_SECRET. Configure a token before exposing the development server.");
  }
}

/** Fixed-size digests keep the comparison independent of token length. */
export function tokenMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected?.trim()) return false;
  const digest = (value: string) => Buffer.from(createHash("sha256").update(value).digest("hex"), "hex");
  return timingSafeEqual(digest(actual), digest(expected.trim()));
}

export function bearerRole(request: ApiRequest, env: Record<string, string | undefined>): "admin" | "cron" | null {
  const header = request.headers?.authorization;
  const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (tokenMatches(bearer, env.ADMIN_API_TOKEN)) return "admin";
  if (tokenMatches(bearer, env.CRON_SECRET)) return "cron";
  return null;
}

/** A loopback socket alone does not distinguish a local browser from a tunnel. */
export function isLocalDevelopmentRequest(request: ApiRequest): boolean {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket?.remoteAddress ?? "")) return false;
  const headers = request.headers ?? {};
  if (Object.keys(headers).some(key => /^x-forwarded-|^(forwarded|cf-connecting-ip|cf-ray)$/i.test(key))) return false;
  const host = headers.host;
  if (typeof host !== "string" || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  try {
    const expected = new URL(`${request.socket?.encrypted ? "https" : "http"}://${host}`).origin;
    const origin = headers.origin;
    if (origin !== undefined) return typeof origin === "string" && origin === expected;
    const site = headers["sec-fetch-site"];
    return site === undefined || site === "same-origin" || site === "none";
  } catch { return false; }
}

export function authorizeWrite(request: ApiRequest, env: Record<string, string | undefined>, development = false): "admin" | "cron" | "local" {
  const role = bearerRole(request, env);
  if (role) return role;
  if (localWriteAllowed(env, development)
    && isLocalDevelopmentRequest(request)) return "local";
  throw new HttpError(401, "관리자 인증이 필요합니다. ?admin에서 유효한 토큰을 저장한 뒤 다시 시도해 주세요.");
}

export function clientIp(request: ApiRequest, trustProxy: string | undefined): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  const hops = trustProxy && /^[1-9]\d*$/.test(trustProxy) ? Number(trustProxy) : 0;
  if (Number.isSafeInteger(hops) && hops > 0 && typeof forwarded === "string") {
    const chain = forwarded.split(",").map(ip => ip.trim()), selected = chain[chain.length - hops];
    if (selected && isIP(selected)) return selected;
  }
  return request.socket?.remoteAddress ?? "unknown";
}

export function localWriteAllowed(env: Record<string, string | undefined>, development = false): boolean {
  return development && !env.ADMIN_API_TOKEN?.trim() && !env.CRON_SECRET?.trim();
}

/** One bounded, process-local fixed window shared by all write routes. */
export function createWriteLimiter(now = Date.now, limit = 10, windowMs = 60_000, maxClients = 10_000) {
  const clients = new Map<string, { count: number; expires: number }>();
  let lastCleanup = -Infinity;
  return (ip: string): number => {
    const time = now();
    if (time - lastCleanup >= 1000) {
      for (const [key, value] of clients) if (value.expires <= time) clients.delete(key);
      lastCleanup = time;
    }
    let client = clients.get(ip);
    if (client && client.expires <= time) { clients.delete(ip); client = undefined; }
    if (!client) {
      if (clients.size >= maxClients) clients.delete(clients.keys().next().value!);
      client = { count: 0, expires: time + windowMs }; clients.set(ip, client);
    }
    return ++client.count > limit ? Math.max(1, Math.ceil((client.expires - time) / 1000)) : 0;
  };
}
