import { Redis } from "@upstash/redis";
import type { Env } from "@/lib/providers/config";
import { createMemoryStore } from "@/lib/store/memory";
import { createRedisStore } from "@/lib/store/redis";
import type { CheckStore } from "@/lib/store/types";

export type { CheckStore } from "@/lib/store/types";

const MEMORY_KEY = Symbol.for("kioku.memory-store");

/** Upstash's own variable names, or the KV_* names the Vercel Marketplace integration sets. */
export function redisConfig(env: Env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() || env.KV_REST_API_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() || env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

let cached: { url: string; store: CheckStore } | undefined;

/** Redis when it's configured; otherwise one in-process store shared by every route bundle. */
export function checkStore(env: Env = process.env): CheckStore {
  const config = redisConfig(env);
  if (config) {
    if (cached?.url !== config.url) {
      cached = { url: config.url, store: createRedisStore(new Redis({ ...config, automaticDeserialization: false, enableTelemetry: false })) };
    }
    return cached.store;
  }
  const holder = globalThis as typeof globalThis & { [MEMORY_KEY]?: CheckStore };
  holder[MEMORY_KEY] ??= createMemoryStore();
  return holder[MEMORY_KEY];
}

/**
 * On Vercel each request can land on a different instance, so in-process state would lose checks and let
 * the daily budget be spent more than once. Returns why checks can't run, or null when they can.
 */
export function storeProblem(env: Env = process.env): string | null {
  if (env.VERCEL !== "1" || redisConfig(env)) return null;
  return "This deployment has no Redis store connected, so checks are switched off. Connect Upstash Redis to the project and redeploy.";
}
