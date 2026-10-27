import type { Env } from "@/lib/providers/config";
import type { CheckStore } from "@/lib/store/types";

export type RateBucket = "check" | "questions" | "intake" | "lookup" | "audit";

const HOUR_MS = 3_600_000;
export const DEFAULT_CHECKS_PER_HOUR = 12;
/** Question plans, intake replies and web lookups call a model too, and site audits fetch other people's sites, so they get limits of their own. */
const FIXED: Record<Exclude<RateBucket, "check">, number> = { questions: 30, intake: 150, lookup: 20, audit: 20 };
/** Audits of one site from everyone together, so Kioku can't be used to hammer it. */
const SITE_AUDITS_PER_HOUR = 30;
const OFF = /^(?:off|none|unlimited|no)$/i;

export interface RateRefusal {
  retryAfterSeconds: number;
  message: string;
}

const limitsOff = (env: Env) => OFF.test(env.SOV_CHECKS_PER_HOUR?.trim() ?? "");

/** Requests allowed per visitor per hour, or null when `SOV_CHECKS_PER_HOUR` is "off". */
export function hourlyLimit(env: Env, bucket: RateBucket): number | null {
  if (limitsOff(env)) return null;
  if (bucket !== "check") return FIXED[bucket];
  const raw = env.SOV_CHECKS_PER_HOUR?.trim() ?? "";
  const value = Number(raw);
  return raw && Number.isInteger(value) && value > 0 ? value : DEFAULT_CHECKS_PER_HOUR;
}

/** Vercel sets x-real-ip and x-forwarded-for itself, so visitors can't pick their own. */
export function visitorId(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return real || forwarded || "local";
}

function waitPhrase(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "in about a minute";
  return `in about ${minutes} minutes`;
}

/** Counts one hit against `key`, returning the seconds to wait once it's over `limit`, or null. Store failures let it through. */
async function overLimit(store: CheckStore, key: string, limit: number, now: number): Promise<number | null> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await store.hit(key, HOUR_MS, now);
  } catch (error) {
    console.error("Rate limit check failed", error);
    return null;
  }
  return hit.count <= limit ? null : Math.max(1, Math.ceil(hit.resetMs / 1000));
}

/**
 * Counts one request for this visitor and returns a refusal once they're over the hour's limit. When the
 * store can't be reached it lets the request through: the daily budget still guards spending.
 */
export async function rateLimit(env: Env, store: CheckStore, bucket: RateBucket, headers: Headers, now = Date.now()): Promise<RateRefusal | null> {
  const limit = hourlyLimit(env, bucket);
  if (limit === null) return null;
  const retryAfterSeconds = await overLimit(store, `${bucket}:${visitorId(headers)}`, limit, now);
  if (retryAfterSeconds === null) return null;
  const wait = waitPhrase(retryAfterSeconds);
  const message =
    bucket === "check"
      ? `That's ${limit} check${limit === 1 ? "" : "s"} from here in the last hour, so I'm taking a short breather. Try again ${wait}. Your earlier reports are still saved.`
      : bucket === "audit"
        ? `That's ${limit} site audits from here in the last hour. Try again ${wait}.`
        : "Too many requests from here in the last hour. Try again a little later.";
  return { retryAfterSeconds, message };
}

/** Counts one audit of `site` from anyone and refuses once the site has had its hour's share. */
export async function siteAuditLimit(env: Env, store: CheckStore, site: string, now = Date.now()): Promise<RateRefusal | null> {
  if (limitsOff(env)) return null;
  const retryAfterSeconds = await overLimit(store, `audit-site:${site}`, SITE_AUDITS_PER_HOUR, now);
  if (retryAfterSeconds === null) return null;
  return {
    retryAfterSeconds,
    message: `Kioku has already checked ${site} ${SITE_AUDITS_PER_HOUR} times in the last hour, so it's giving the site a rest. Try again ${waitPhrase(retryAfterSeconds)}.`,
  };
}
