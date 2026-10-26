import type { Env } from "@/lib/providers/config";
import type { CheckStore } from "@/lib/store/types";

export type RateBucket = "check" | "questions" | "intake";

const HOUR_MS = 3_600_000;
export const DEFAULT_CHECKS_PER_HOUR = 12;
/** Question plans and intake replies call a model too, so they get roomy limits of their own. */
const FIXED: Record<Exclude<RateBucket, "check">, number> = { questions: 30, intake: 150 };
const OFF = /^(?:off|none|unlimited|no)$/i;

export interface RateRefusal {
  retryAfterSeconds: number;
  message: string;
}

/** Requests allowed per visitor per hour, or null when `SOV_CHECKS_PER_HOUR` is "off". */
export function hourlyLimit(env: Env, bucket: RateBucket): number | null {
  const raw = env.SOV_CHECKS_PER_HOUR?.trim() ?? "";
  if (OFF.test(raw)) return null;
  if (bucket !== "check") return FIXED[bucket];
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

/**
 * Counts one request for this visitor and returns a refusal once they're over the hour's limit. When the
 * store can't be reached it lets the request through: the daily budget still guards spending.
 */
export async function rateLimit(env: Env, store: CheckStore, bucket: RateBucket, headers: Headers, now = Date.now()): Promise<RateRefusal | null> {
  const limit = hourlyLimit(env, bucket);
  if (limit === null) return null;
  let hit: { count: number; resetMs: number };
  try {
    hit = await store.hit(`${bucket}:${visitorId(headers)}`, HOUR_MS, now);
  } catch (error) {
    console.error("Rate limit check failed", error);
    return null;
  }
  if (hit.count <= limit) return null;
  const retryAfterSeconds = Math.max(1, Math.ceil(hit.resetMs / 1000));
  const message =
    bucket === "check"
      ? `That's ${limit} check${limit === 1 ? "" : "s"} from here in the last hour, so I'm taking a short breather. Try again ${waitPhrase(retryAfterSeconds)}. Your earlier reports are still saved.`
      : "Too many requests from here in the last hour. Try again a little later.";
  return { retryAfterSeconds, message };
}
