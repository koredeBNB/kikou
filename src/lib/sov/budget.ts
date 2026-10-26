import type { Env } from "@/lib/providers/config";
import { formatUsd } from "@/lib/sov/estimate";

export const DEFAULT_DAILY_BUDGET_USD = 20;

export interface SpendLedger {
  /** UTC date (YYYY-MM-DD) the totals belong to. */
  day: string;
  spentUsd: number;
  /** Estimates held by checks that are still running. */
  reservedUsd: number;
}

export interface BudgetStatus {
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  resetsInSeconds: number;
}

export interface Reservation {
  day: string;
  amountUsd: number;
}

export type BudgetClaim =
  | ({ ok: true } & Reservation)
  | { ok: false; limitUsd: number; remainingUsd: number; retryAfterSeconds: number; message: string };

const HOUR_MS = 3_600_000;
const STORE_KEY = Symbol.for("kioku.daily-spend");
const OFF = /^(?:off|none|unlimited|no)$/i;

/** The process-wide ledger. It lives on globalThis so every route bundle shares it, and resets when the server restarts. */
export function spendLedger(): SpendLedger {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: SpendLedger };
  holder[STORE_KEY] ??= { day: "", spentUsd: 0, reservedUsd: 0 };
  return holder[STORE_KEY];
}

/** `SOV_MAX_SPEND_PER_DAY` in US dollars, $20 by default. "off" removes the cap. */
export function dailyBudget(env: Env): number | null {
  const raw = env.SOV_MAX_SPEND_PER_DAY?.trim() ?? "";
  if (OFF.test(raw)) return null;
  const value = Number(raw.replace(/^\$/, ""));
  return raw && Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_BUDGET_USD;
}

const today = (now: Date) => now.toISOString().slice(0, 10);
const cents = (value: number) => Math.round(value * 100) / 100;

function untilMidnightUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

function current(store: SpendLedger, now: Date): SpendLedger {
  const day = today(now);
  if (store.day !== day) Object.assign(store, { day, spentUsd: 0, reservedUsd: 0 });
  return store;
}

function waitPhrase(waitMs: number): string {
  const hours = Math.round(waitMs / HOUR_MS);
  if (waitMs < HOUR_MS) return "in under an hour";
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

export function budgetStatus(env: Env, now = new Date(), store = spendLedger()): BudgetStatus | null {
  const limitUsd = dailyBudget(env);
  if (limitUsd === null) return null;
  const { spentUsd, reservedUsd } = current(store, now);
  return {
    limitUsd,
    spentUsd,
    reservedUsd,
    remainingUsd: Math.max(0, limitUsd - spentUsd - reservedUsd),
    resetsInSeconds: Math.ceil(untilMidnightUtc(now) / 1000),
  };
}

function refusal(costUsd: number, status: BudgetStatus, waitMs: number): string {
  const limit = formatUsd(status.limitUsd);
  const wait = waitPhrase(waitMs);
  if (status.remainingUsd < 0.01) {
    return `We've spent today's ${limit} budget, so I can't ask the assistants again just yet. It resets at midnight UTC, ${wait}. Your earlier reports are still saved.`;
  }
  return `That check would cost about ${formatUsd(costUsd)}, but only ${formatUsd(status.remainingUsd)} of today's ${limit} budget is left. Try fewer questions or assistants, or turn off web search. The budget resets at midnight UTC, ${wait}.`;
}

/** Holds a check's estimated cost against today's budget, or explains why it can't run. Free checks always pass. */
export function reserveBudget(env: Env, costUsd: number, now = new Date(), store = spendLedger()): BudgetClaim {
  const status = budgetStatus(env, now, store);
  const amountUsd = Math.max(0, costUsd);
  if (status && amountUsd > 0 && amountUsd > status.remainingUsd + 1e-9) {
    const waitMs = untilMidnightUtc(now);
    return {
      ok: false,
      limitUsd: status.limitUsd,
      remainingUsd: cents(status.remainingUsd),
      retryAfterSeconds: Math.ceil(waitMs / 1000),
      message: refusal(amountUsd, status, waitMs),
    };
  }
  const ledger = current(store, now);
  ledger.reservedUsd += amountUsd;
  return { ok: true, day: ledger.day, amountUsd };
}

/** Releases a reservation and books what the check actually cost to the current day. */
export function settleBudget(reservation: Reservation, actualUsd: number, now = new Date(), store = spendLedger()): void {
  const ledger = current(store, now);
  if (reservation.day === ledger.day) ledger.reservedUsd = Math.max(0, ledger.reservedUsd - reservation.amountUsd);
  ledger.spentUsd += Math.max(0, actualUsd);
}

/** The client's heads-up before a check the server would refuse. Null when it fits or there's no budget. */
export function budgetNote(costUsd: number, budget: { limitUsd: number; remainingUsd: number } | null): string | null {
  if (!budget || costUsd <= budget.remainingUsd) return null;
  const limit = formatUsd(budget.limitUsd);
  if (budget.remainingUsd < 0.01) return `Today's ${limit} budget is used up. It resets at midnight UTC.`;
  return `That's more than the ${formatUsd(budget.remainingUsd)} left in today's ${limit} budget. Try fewer questions or assistants, or turn off web search.`;
}
