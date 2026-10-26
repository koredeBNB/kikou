import {
  CLAIM_MS,
  DAY_TTL_SECONDS,
  fromMicros,
  HOLD_LEASE_MS,
  RUN_TTL_SECONDS,
  toMicros,
  type CheckStore,
  type ClaimResult,
  type CompleteRequest,
  type HoldRequest,
  type Ledger,
  type RunRecord,
  type TaskResult,
} from "@/lib/store/types";

interface RunState {
  run: RunRecord;
  expiresAt: number;
  results: Map<string, TaskResult>;
  /** Task → when its claim runs out. */
  claims: Map<string, number>;
  costMicros: number;
}

interface DayState {
  spentMicros: number;
  /** Run → micro-dollars held, and when the hold lapses. */
  holds: Map<string, { micros: number; until: number }>;
  expiresAt: number;
}

/** The same behaviour as the Redis store, in this process only. For local development and tests. */
export function createMemoryStore(): CheckStore {
  const runs = new Map<string, RunState>();
  const days = new Map<string, DayState>();
  const counters = new Map<string, { count: number; resetAt: number }>();

  const runState = (id: string, now: number) => {
    const state = runs.get(id);
    if (state && state.expiresAt <= now) {
      runs.delete(id);
      return undefined;
    }
    return state;
  };

  const dayState = (day: string, now: number): DayState => {
    let state = days.get(day);
    if (!state || state.expiresAt <= now) {
      state = { spentMicros: 0, holds: new Map(), expiresAt: now + DAY_TTL_SECONDS * 1000 };
      days.set(day, state);
    }
    for (const [runId, hold] of state.holds) if (hold.until <= now) state.holds.delete(runId);
    return state;
  };

  const ledgerOf = (state: DayState): Ledger => ({
    spentUsd: fromMicros(state.spentMicros),
    heldUsd: fromMicros([...state.holds.values()].reduce((sum, h) => sum + h.micros, 0)),
  });

  return {
    persistent: false,

    async saveRun(run) {
      runs.set(run.id, { run: structuredClone(run), expiresAt: run.createdAt + RUN_TTL_SECONDS * 1000, results: new Map(), claims: new Map(), costMicros: 0 });
    },

    async loadRun(id) {
      const state = runState(id, Date.now());
      return state ? structuredClone(state.run) : null;
    },

    async hold({ day, runId, estimateUsd, totalTasks, limitUsd, now }: HoldRequest) {
      const state = dayState(day, now);
      const mine = state.holds.get(runId);
      if (mine) {
        mine.until = now + HOLD_LEASE_MS;
        return { ok: true, ...ledgerOf(state) };
      }
      const done = runs.get(runId)?.results.size ?? 0;
      const micros = Math.floor((toMicros(estimateUsd) * Math.max(0, totalTasks - done)) / Math.max(1, totalTasks));
      const { spentUsd, heldUsd } = ledgerOf(state);
      if (limitUsd !== null && micros > 0 && state.spentMicros + toMicros(heldUsd) + micros > toMicros(limitUsd)) {
        return { ok: false, spentUsd, heldUsd };
      }
      state.holds.set(runId, { micros, until: now + HOLD_LEASE_MS });
      return { ok: true, ...ledgerOf(state) };
    },

    async ledger(day, now) {
      return ledgerOf(dayState(day, now));
    },

    async claim(runId, task, now): Promise<ClaimResult> {
      const state = runState(runId, now);
      if (!state) return { state: "busy" };
      const result = state.results.get(task);
      if (result) return { state: "done", result: structuredClone(result) };
      if ((state.claims.get(task) ?? 0) > now) return { state: "busy" };
      state.claims.set(task, now + CLAIM_MS);
      return { state: "claimed" };
    },

    async complete({ runId, task, result, costUsd, day, now }: CompleteRequest) {
      const state = runState(runId, now);
      if (!state || state.results.has(task)) return;
      state.results.set(task, structuredClone(result));
      state.claims.delete(task);
      const micros = toMicros(costUsd);
      const ledger = dayState(day, now);
      ledger.spentMicros += micros;
      state.costMicros += micros;
      const hold = ledger.holds.get(runId);
      if (hold) {
        hold.micros = Math.max(0, hold.micros - micros);
        hold.until = now + HOLD_LEASE_MS;
      }
    },

    async release(runId, dayList) {
      for (const day of dayList) days.get(day)?.holds.delete(runId);
      return { costUsd: fromMicros(runs.get(runId)?.costMicros ?? 0) };
    },

    async hit(key, windowMs, now) {
      let counter = counters.get(key);
      if (!counter || counter.resetAt <= now) {
        counter = { count: 0, resetAt: now + windowMs };
        counters.set(key, counter);
      }
      counter.count++;
      return { count: counter.count, resetMs: counter.resetAt - now };
    },
  };
}
