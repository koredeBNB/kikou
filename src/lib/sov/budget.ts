import type { Env } from "@/lib/providers/config";
import { formatUsd } from "@/lib/sov/estimate";
import type { CheckStore } from "@/lib/store/types";

export const DEFAULT_DAILY_BUDGET_USD = 20;

export interface BudgetStatus {
  limitUsd: number;
  spentUsd: number;
  /** Estimates held by checks that are still running. */
  reservedUsd: number;
  remainingUsd: number;
  resetsInSeconds: number;
}

export type BudgetClaim = { ok: true } | { ok: false; limitUsd: number; remainingUsd: number; retryAfterSeconds: number; message: string };

const HOUR_MS = 3_600_000;
const OFF = /^(?:off|none|unlimited|no)$/i;

/** `SOV_MAX_SPEND_PER_DAY` in US dollars, $20 by default. "off" removes the cap. */
export function dailyBudget(env: Env): number | null {
  const raw = env.SOV_MAX_SPEND_PER_DAY?.trim() ?? "";
  if (OFF.test(raw)) return null;
  const value = Number(raw.replace(/^\$/, ""));
  return raw && Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_BUDGET_USD;
}

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const cents = (value: number) => Math.round(value * 100) / 100;

function untilMidnightUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

function waitPhrase(waitMs: number): string {
  const hours = Math.round(waitMs / HOUR_MS);
  if (waitMs < HOUR_MS) return "in under an hour";
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

function statusOf(limitUsd: number, spentUsd: number, reservedUsd: number, now: Date): BudgetStatus {
  return {
    limitUsd,
    spentUsd,
    reservedUsd,
    remainingUsd: Math.max(0, limitUsd - spentUsd - reservedUsd),
    resetsInSeconds: Math.ceil(untilMidnightUtc(now) / 1000),
  };
}

export async function budgetStatus(env: Env, store: CheckStore, now = new Date()): Promise<BudgetStatus | null> {
  const limitUsd = dailyBudget(env);
  if (limitUsd === null) return null;
  const { spentUsd, heldUsd } = await store.ledger(utcDay(now), now.getTime());
  return statusOf(limitUsd, spentUsd, heldUsd, now);
}

function refusal(costUsd: number, status: BudgetStatus, waitMs: number): string {
  const limit = formatUsd(status.limitUsd);
  const wait = waitPhrase(waitMs);
  if (status.remainingUsd < 0.01) {
    return `We've spent today's ${limit} budget, so I can't ask the assistants again just yet. It resets at midnight UTC, ${wait}. Your earlier reports are still saved.`;
  }
  return `That check would cost about ${formatUsd(costUsd)}, but only ${formatUsd(status.remainingUsd)} of today's ${limit} budget is left. Try fewer questions or assistants, or turn off web search. The budget resets at midnight UTC, ${wait}.`;
}

/**
 * Holds a check's estimate against today's budget, or renews the hold it already has, or explains why it
 * can't run. Free checks always pass. Each answer then books what it really cost and draws the hold down.
 */
export async function holdBudget(
  env: Env,
  store: CheckStore,
  { runId, estimateUsd, totalTasks, now = new Date() }: { runId: string; estimateUsd: number; totalTasks: number; now?: Date },
): Promise<BudgetClaim> {
  const limitUsd = dailyBudget(env);
  const result = await store.hold({ day: utcDay(now), runId, estimateUsd: Math.max(0, estimateUsd), totalTasks, limitUsd, now: now.getTime() });
  if (result.ok || limitUsd === null) return { ok: true };
  const status = statusOf(limitUsd, result.spentUsd, result.heldUsd, now);
  const waitMs = untilMidnightUtc(now);
  return {
    ok: false,
    limitUsd,
    remainingUsd: cents(status.remainingUsd),
    retryAfterSeconds: Math.ceil(waitMs / 1000),
    message: refusal(estimateUsd, status, waitMs),
  };
}

/** The client's heads-up before a check the server would refuse. Null when it fits or there's no budget. */
export function budgetNote(costUsd: number, budget: { limitUsd: number; remainingUsd: number } | null): string | null {
  if (!budget || costUsd <= budget.remainingUsd) return null;
  const limit = formatUsd(budget.limitUsd);
  if (budget.remainingUsd < 0.01) return `Today's ${limit} budget is used up. It resets at midnight UTC.`;
  return `That's more than the ${formatUsd(budget.remainingUsd)} left in today's ${limit} budget. Try fewer questions or assistants, or turn off web search.`;
}
