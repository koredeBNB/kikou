import { Redis } from "@upstash/redis";
import {
  CLAIM_MS,
  DAY_TTL_SECONDS,
  fromMicros,
  HOLD_LEASE_MS,
  RUN_TTL_SECONDS,
  toMicros,
  type CheckStore,
  type ClaimResult,
  type RunRecord,
  type TaskResult,
} from "@/lib/store/types";

const PREFIX = "kioku";
const runKey = (id: string) => `${PREFIX}:run:${id}`;
const resultsKey = (id: string) => `${PREFIX}:run:${id}:results`;
const claimsKey = (id: string) => `${PREFIX}:run:${id}:claims`;
const costKey = (id: string) => `${PREFIX}:run:${id}:cost`;
const spendKey = (day: string) => `${PREFIX}:spend:${day}`;
const holdsKey = (day: string) => `${PREFIX}:holds:${day}`;
const leasesKey = (day: string) => `${PREFIX}:leases:${day}`;
const counterKey = (key: string) => `${PREFIX}:rate:${key}`;

/** Drops lapsed holds and returns the micro-dollars still held. KEYS[2] holds, KEYS[3] lease expiries. */
const PRUNE = `
local function prune(holds, leases, now)
  local stale = redis.call('ZRANGEBYSCORE', leases, '-inf', now)
  for i = 1, #stale do redis.call('HDEL', holds, stale[i]) end
  if #stale > 0 then redis.call('ZREMRANGEBYSCORE', leases, '-inf', now) end
  local held = 0
  local values = redis.call('HVALS', holds)
  for i = 1, #values do held = held + tonumber(values[i]) end
  return held
end
`;

/**
 * KEYS: spend, holds, leases, results. ARGV: now, runId, estimate, totalTasks, limit (-1 for none), lease ms, day ttl.
 * Returns {ok, spent, held}.
 */
const HOLD = `${PRUNE}
local now = tonumber(ARGV[1])
local held = prune(KEYS[2], KEYS[3], now)
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if not redis.call('HGET', KEYS[2], ARGV[2]) then
  local total = math.max(1, tonumber(ARGV[4]))
  local left = math.max(0, total - redis.call('HLEN', KEYS[4]))
  local amount = math.floor(tonumber(ARGV[3]) * left / total)
  local limit = tonumber(ARGV[5])
  if limit >= 0 and amount > 0 and spent + held + amount > limit then return {0, spent, held} end
  redis.call('HSET', KEYS[2], ARGV[2], amount)
  held = held + amount
end
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[6]), ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[7])
redis.call('EXPIRE', KEYS[3], ARGV[7])
return {1, spent, held}
`;

/** KEYS: spend, holds, leases. ARGV: now. Returns {spent, held}. */
const LEDGER = `${PRUNE}
local held = prune(KEYS[2], KEYS[3], tonumber(ARGV[1]))
return {tonumber(redis.call('GET', KEYS[1]) or '0'), held}
`;

/** KEYS: results, claims. ARGV: task, now, claim ms, run ttl. Returns {state, result}. */
const CLAIM = `
local done = redis.call('HGET', KEYS[1], ARGV[1])
if done then return {'done', done} end
local now = tonumber(ARGV[2])
if tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0') > now then return {'busy', ''} end
redis.call('HSET', KEYS[2], ARGV[1], now + tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[2], ARGV[4])
return {'claimed', ''}
`;

/**
 * KEYS: results, claims, cost, spend, holds, leases. ARGV: task, result, cost, runId, now, lease ms, run ttl, day ttl.
 * Returns 1 when the result was new.
 */
const COMPLETE = `
if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2]) == 0 then return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('HDEL', KEYS[2], ARGV[1])
local cost = tonumber(ARGV[3])
if cost > 0 then
  redis.call('INCRBY', KEYS[3], cost)
  redis.call('EXPIRE', KEYS[3], ARGV[7])
  redis.call('INCRBY', KEYS[4], cost)
  redis.call('EXPIRE', KEYS[4], ARGV[8])
end
local held = redis.call('HGET', KEYS[5], ARGV[4])
if held then
  redis.call('HSET', KEYS[5], ARGV[4], math.max(0, tonumber(held) - cost))
  redis.call('ZADD', KEYS[6], tonumber(ARGV[5]) + tonumber(ARGV[6]), ARGV[4])
end
return 1
`;

/** KEYS: cost, then holds and leases for each day. ARGV: runId. Returns the run's cost. */
const RELEASE = `
for i = 2, #KEYS, 2 do
  redis.call('HDEL', KEYS[i], ARGV[1])
  redis.call('ZREM', KEYS[i + 1], ARGV[1])
end
return tonumber(redis.call('GET', KEYS[1]) or '0')
`;

/** KEYS: spend. ARGV: cost, day ttl. */
const CHARGE = `
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

/** KEYS: counter. ARGV: window ms. Returns {count, ms until reset}. */
const HIT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const s = (value: number) => String(Math.round(value));

export function createRedisStore(redis: Redis): CheckStore {
  const hold = redis.createScript<[number, number, number]>(HOLD);
  const ledger = redis.createScript<[number, number]>(LEDGER);
  const claim = redis.createScript<[string, string]>(CLAIM);
  const complete = redis.createScript<number>(COMPLETE);
  const release = redis.createScript<number>(RELEASE);
  const charge = redis.createScript<number>(CHARGE);
  const hit = redis.createScript<[number, number]>(HIT);

  return {
    persistent: true,

    async saveRun(run: RunRecord) {
      await redis.set(runKey(run.id), JSON.stringify(run), { ex: RUN_TTL_SECONDS });
    },

    async loadRun(id) {
      const raw = await redis.get<string>(runKey(id));
      return raw ? (JSON.parse(raw) as RunRecord) : null;
    },

    async hold({ day, runId, estimateUsd, totalTasks, limitUsd, now }) {
      const [ok, spent, held] = await hold.exec(
        [spendKey(day), holdsKey(day), leasesKey(day), resultsKey(runId)],
        [s(now), runId, s(toMicros(estimateUsd)), s(totalTasks), limitUsd === null ? "-1" : s(toMicros(limitUsd)), s(HOLD_LEASE_MS), s(DAY_TTL_SECONDS)],
      );
      return { ok: Number(ok) === 1, spentUsd: fromMicros(Number(spent)), heldUsd: fromMicros(Number(held)) };
    },

    async ledger(day, now) {
      const [spent, held] = await ledger.exec([spendKey(day), holdsKey(day), leasesKey(day)], [s(now)]);
      return { spentUsd: fromMicros(Number(spent)), heldUsd: fromMicros(Number(held)) };
    },

    async claim(runId, task, now): Promise<ClaimResult> {
      const [state, raw] = await claim.exec([resultsKey(runId), claimsKey(runId)], [task, s(now), s(CLAIM_MS), s(RUN_TTL_SECONDS)]);
      if (state === "done") return { state: "done", result: JSON.parse(raw) as TaskResult };
      return state === "claimed" ? { state: "claimed" } : { state: "busy" };
    },

    async complete({ runId, task, result, costUsd, day, now }) {
      await complete.exec(
        [resultsKey(runId), claimsKey(runId), costKey(runId), spendKey(day), holdsKey(day), leasesKey(day)],
        [task, JSON.stringify(result), s(toMicros(costUsd)), runId, s(now), s(HOLD_LEASE_MS), s(RUN_TTL_SECONDS), s(DAY_TTL_SECONDS)],
      );
    },

    async release(runId, days) {
      const keys = [costKey(runId), ...[...new Set(days)].flatMap((day) => [holdsKey(day), leasesKey(day)])];
      return { costUsd: fromMicros(Number(await release.exec(keys, [runId]))) };
    },

    async charge(day, costUsd) {
      const micros = toMicros(costUsd);
      if (micros > 0) await charge.exec([spendKey(day)], [s(micros), s(DAY_TTL_SECONDS)]);
    },

    async hit(key, windowMs) {
      const [count, resetMs] = await hit.exec([counterKey(key)], [s(windowMs)]);
      return { count: Number(count), resetMs: Number(resetMs) };
    },
  };
}
