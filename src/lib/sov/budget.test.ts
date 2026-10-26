import { describe, expect, it } from "vitest";
import { budgetNote, budgetStatus, dailyBudget, reserveBudget, settleBudget, type SpendLedger } from "@/lib/sov/budget";

const at = (iso: string) => new Date(iso);
const ledger = (): SpendLedger => ({ day: "", spentUsd: 0, reservedUsd: 0 });

describe("dailyBudget", () => {
  it("defaults to $20 a day and reads SOV_MAX_SPEND_PER_DAY in dollars", () => {
    expect(dailyBudget({})).toBe(20);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "" })).toBe(20);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: " 35 " })).toBe(35);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "$7.50" })).toBe(7.5);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "0" })).toBe(0);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "lots" })).toBe(20);
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "-3" })).toBe(20);
  });

  it("can be switched off", () => {
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "off" })).toBeNull();
    expect(dailyBudget({ SOV_MAX_SPEND_PER_DAY: "unlimited" })).toBeNull();
  });
});

describe("reserveBudget and settleBudget", () => {
  const env = { SOV_MAX_SPEND_PER_DAY: "20" };
  const now = at("2026-10-26T18:00:00Z");

  it("reserves a check's estimate, then swaps it for the actual cost", () => {
    const store = ledger();
    const claim = reserveBudget(env, 11.5, now, store);
    expect(claim).toMatchObject({ ok: true, amountUsd: 11.5, day: "2026-10-26" });
    expect(store).toEqual({ day: "2026-10-26", spentUsd: 0, reservedUsd: 11.5 });
    expect(budgetStatus(env, now, store)).toMatchObject({ limitUsd: 20, spentUsd: 0, reservedUsd: 11.5, remainingUsd: 8.5 });

    if (claim.ok) settleBudget(claim, 10.92, now, store);
    expect(store.reservedUsd).toBe(0);
    expect(store.spentUsd).toBeCloseTo(10.92, 6);
    expect(budgetStatus(env, now, store)?.remainingUsd).toBeCloseTo(9.08, 6);
  });

  it("blocks a check whose estimate is more than what's left, and says what's left", () => {
    const store = ledger();
    reserveBudget(env, 15.8, now, store);
    const refused = reserveBudget(env, 11.5, now, store);
    expect(refused).toMatchObject({ ok: false, remainingUsd: 4.2, limitUsd: 20, retryAfterSeconds: 6 * 3600 });
    expect(refused.ok === false && refused.message).toBe(
      "That check would cost about $11.50, but only $4.20 of today's $20.00 budget is left. Try fewer questions or assistants, or turn off web search. The budget resets at midnight UTC, in about 6 hours.",
    );
    expect(store.reservedUsd).toBeCloseTo(15.8, 6);
  });

  it("says so plainly once the day's budget is spent", () => {
    const store = ledger();
    const claim = reserveBudget(env, 20, at("2026-10-26T23:30:00Z"), store);
    if (claim.ok) settleBudget(claim, 20, at("2026-10-26T23:30:00Z"), store);
    const refused = reserveBudget(env, 0.4, at("2026-10-26T23:30:00Z"), store);
    expect(refused.ok === false && refused.message).toBe(
      "We've spent today's $20.00 budget, so I can't ask the assistants again just yet. It resets at midnight UTC, in under an hour. Your earlier reports are still saved.",
    );
  });

  it("lets free demo checks through even when the budget is spent", () => {
    const store = ledger();
    const claim = reserveBudget({ SOV_MAX_SPEND_PER_DAY: "0" }, 0, now, store);
    expect(claim.ok).toBe(true);
  });

  it("starts each UTC day afresh, and books a check that ran past midnight to the new day", () => {
    const store = ledger();
    const claim = reserveBudget(env, 19, at("2026-10-26T23:58:00Z"), store);
    expect(reserveBudget(env, 2, at("2026-10-26T23:59:00Z"), store).ok).toBe(false);
    if (claim.ok) settleBudget(claim, 18, at("2026-10-27T00:03:00Z"), store);
    expect(store).toEqual({ day: "2026-10-27", spentUsd: 18, reservedUsd: 0 });
    expect(budgetStatus(env, at("2026-10-27T00:03:00Z"), store)?.remainingUsd).toBe(2);
  });

  it("never blocks without a budget", () => {
    const store = ledger();
    for (let i = 0; i < 20; i++) expect(reserveBudget({ SOV_MAX_SPEND_PER_DAY: "off" }, 50, now, store).ok).toBe(true);
    expect(budgetStatus({ SOV_MAX_SPEND_PER_DAY: "off" }, now, store)).toBeNull();
  });
});

describe("budgetNote", () => {
  it("says nothing when the check fits, or there's no budget", () => {
    expect(budgetNote(3, { limitUsd: 20, remainingUsd: 4.2 })).toBeNull();
    expect(budgetNote(30, null)).toBeNull();
  });

  it("says what's left when the estimate is more than today's budget allows", () => {
    expect(budgetNote(9.05, { limitUsd: 20, remainingUsd: 4.2 })).toBe(
      "That's more than the $4.20 left in today's $20.00 budget. Try fewer questions or assistants, or turn off web search.",
    );
    expect(budgetNote(1, { limitUsd: 20, remainingUsd: 0 })).toBe("Today's $20.00 budget is used up. It resets at midnight UTC.");
  });
});
