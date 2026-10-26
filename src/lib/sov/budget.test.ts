import { describe, expect, it } from "vitest";
import { budgetNote, budgetStatus, dailyBudget, holdBudget } from "@/lib/sov/budget";
import { createMemoryStore } from "@/lib/store/memory";
import { HOLD_LEASE_MS, type CheckStore, type RunRecord } from "@/lib/store/types";

const at = (iso: string) => new Date(iso);

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

describe("holdBudget", () => {
  const env = { SOV_MAX_SPEND_PER_DAY: "20" };
  const now = at("2026-10-26T18:00:00Z");
  const run = (id: string, estimateUsd: number, when = now): RunRecord => ({
    id,
    day: when.toISOString().slice(0, 10),
    createdAt: when.getTime(),
    brief: { product: "Acme", category: "CRM", audience: "", competitors: [] },
    questions: [{ id: "q1", text: "Best CRM?", intent: "best-for" }],
    models: ["claude"],
    webSearch: true,
    estimateUsd,
  });
  const begin = async (store: CheckStore, id: string, estimateUsd: number, when = now, budget = env) => {
    await store.saveRun(run(id, estimateUsd, when));
    return holdBudget(budget, store, { runId: id, estimateUsd, totalTasks: 1, now: when });
  };
  const answer = (store: CheckStore, runId: string, costUsd: number, when = now) =>
    store.complete({
      runId,
      task: "claude:q1",
      result: { type: "answer", answer: { questionId: "q1", model: "claude", text: "Acme", citations: [], source: "live", latencyMs: 1 } },
      costUsd,
      day: when.toISOString().slice(0, 10),
      now: when.getTime(),
    });

  it("holds a check's estimate, then swaps it for what the answers actually cost", async () => {
    const store = createMemoryStore();
    expect(await begin(store, "a", 11.5)).toEqual({ ok: true });
    expect(await budgetStatus(env, store, now)).toMatchObject({ limitUsd: 20, spentUsd: 0, reservedUsd: 11.5, remainingUsd: 8.5 });

    await answer(store, "a", 10.92);
    expect((await budgetStatus(env, store, now))?.reservedUsd).toBeCloseTo(0.58, 6);
    expect(await store.release("a", ["2026-10-26"])).toEqual({ costUsd: 10.92 });
    const after = await budgetStatus(env, store, now);
    expect(after).toMatchObject({ reservedUsd: 0 });
    expect(after?.spentUsd).toBeCloseTo(10.92, 6);
    expect(after?.remainingUsd).toBeCloseTo(9.08, 6);
  });

  it("blocks a check whose estimate is more than what's left, and says what's left", async () => {
    const store = createMemoryStore();
    await begin(store, "a", 15.8);
    const refused = await begin(store, "b", 11.5);
    expect(refused).toMatchObject({ ok: false, remainingUsd: 4.2, limitUsd: 20, retryAfterSeconds: 6 * 3600 });
    expect(refused.ok === false && refused.message).toBe(
      "That check would cost about $11.50, but only $4.20 of today's $20.00 budget is left. Try fewer questions or assistants, or turn off web search. The budget resets at midnight UTC, in about 6 hours.",
    );
    expect((await budgetStatus(env, store, now))?.reservedUsd).toBeCloseTo(15.8, 6);
  });

  it("says so plainly once the day's budget is spent", async () => {
    const late = at("2026-10-26T23:30:00Z");
    const store = createMemoryStore();
    await begin(store, "a", 20, late);
    await answer(store, "a", 20, late);
    await store.release("a", ["2026-10-26"]);
    const refused = await begin(store, "b", 0.4, late);
    expect(refused.ok === false && refused.message).toBe(
      "We've spent today's $20.00 budget, so I can't ask the assistants again just yet. It resets at midnight UTC, in under an hour. Your earlier reports are still saved.",
    );
  });

  it("lets free demo checks through even when the budget is spent", async () => {
    expect((await begin(createMemoryStore(), "a", 0, now, { SOV_MAX_SPEND_PER_DAY: "0" })).ok).toBe(true);
  });

  it("renews a running check's hold without checking the budget again", async () => {
    const store = createMemoryStore();
    await begin(store, "a", 19);
    expect((await holdBudget(env, store, { runId: "a", estimateUsd: 19, totalTasks: 1, now })).ok).toBe(true);
    expect((await budgetStatus(env, store, now))?.reservedUsd).toBe(19);
  });

  it("frees the hold of a check nobody is driving any more", async () => {
    const store = createMemoryStore();
    await begin(store, "a", 19);
    const later = new Date(now.getTime() + HOLD_LEASE_MS + 1);
    expect((await budgetStatus(env, store, later))?.reservedUsd).toBe(0);
    expect((await begin(store, "b", 19, later)).ok).toBe(true);
  });

  it("starts each UTC day afresh, and books a check that ran past midnight to the new day", async () => {
    const store = createMemoryStore();
    await begin(store, "a", 19, at("2026-10-26T23:58:00Z"));
    expect((await begin(store, "b", 2, at("2026-10-26T23:59:00Z"))).ok).toBe(false);
    const after = at("2026-10-27T00:03:00Z");
    expect((await holdBudget(env, store, { runId: "a", estimateUsd: 19, totalTasks: 1, now: after })).ok).toBe(true);
    await answer(store, "a", 18, after);
    await store.release("a", ["2026-10-26", "2026-10-27"]);
    expect(await budgetStatus(env, store, after)).toMatchObject({ spentUsd: 18, reservedUsd: 0, remainingUsd: 2 });
    expect(await budgetStatus(env, store, at("2026-10-26T23:59:30Z"))).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it("never blocks without a budget", async () => {
    const store = createMemoryStore();
    const off = { SOV_MAX_SPEND_PER_DAY: "off" };
    for (let i = 0; i < 20; i++) expect((await begin(store, `r${i}`, 50, now, off)).ok).toBe(true);
    expect(await budgetStatus(off, store, now)).toBeNull();
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
