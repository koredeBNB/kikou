import type { Env } from "@/lib/providers/config";

export interface CheckCounter {
  /** UTC date (YYYY-MM-DD) the count belongs to. */
  day: string;
  count: number;
}

export type CheckClaim =
  | { ok: true; remaining: number | null }
  | { ok: false; limit: number; retryAfterSeconds: number; message: string };

const HOUR_MS = 3_600_000;
const STORE_KEY = Symbol.for("meadowlark.daily-checks");

/** The process-wide counter. It lives on globalThis so every route bundle shares it, and resets when the server restarts. */
export function dailyChecks(): CheckCounter {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: CheckCounter };
  holder[STORE_KEY] ??= { day: "", count: 0 };
  return holder[STORE_KEY];
}

export function dailyCheckLimit(env: Env): number | null {
  const limit = Math.floor(Number(env.SOV_MAX_CHECKS_PER_DAY?.trim() || NaN));
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

function untilMidnightUtc(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return midnight - now.getTime();
}

function limitMessage(limit: number, waitMs: number): string {
  const used = limit === 1 ? "today's one check" : `all ${limit} checks for today`;
  const hours = Math.round(waitMs / HOUR_MS);
  const wait = waitMs < HOUR_MS ? "in under an hour" : hours === 1 ? "in about an hour" : `in about ${hours} hours`;
  return `We've used ${used}, so I can't ask the assistants again just yet. The limit resets at midnight UTC, ${wait}. Your earlier reports are still saved.`;
}

/** Counts one full check against today's cap, or explains why it can't run. */
export function claimCheck(env: Env, now = new Date(), store = dailyChecks()): CheckClaim {
  const limit = dailyCheckLimit(env);
  if (limit === null) return { ok: true, remaining: null };
  const day = now.toISOString().slice(0, 10);
  if (store.day !== day) Object.assign(store, { day, count: 0 });
  if (store.count >= limit) {
    const waitMs = untilMidnightUtc(now);
    return { ok: false, limit, retryAfterSeconds: Math.ceil(waitMs / 1000), message: limitMessage(limit, waitMs) };
  }
  store.count += 1;
  return { ok: true, remaining: limit - store.count };
}
