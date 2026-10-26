import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/lib/store/memory";
import { createRedisStore } from "@/lib/store/redis";
import { CLAIM_MS, HOLD_LEASE_MS, type CheckStore, type RunRecord, type TaskResult } from "@/lib/store/types";

// Set KIOKU_TEST_REDIS_URL and KIOKU_TEST_REDIS_TOKEN to run the same cases against a real Redis REST endpoint.
const redisUrl = process.env.KIOKU_TEST_REDIS_URL;
const stores: [string, () => CheckStore][] = [["memory", createMemoryStore]];
if (redisUrl) {
  const redis = new Redis({ url: redisUrl, token: process.env.KIOKU_TEST_REDIS_TOKEN ?? "", automaticDeserialization: false, enableTelemetry: false });
  stores.push(["redis", () => createRedisStore(redis)]);
}

const unique = () => `t${Math.random().toString(36).slice(2, 10)}`;
const run = (id: string, day: string, questions = 2): RunRecord => ({
  id,
  day,
  createdAt: Date.now(),
  brief: { product: "Acme", category: "CRM", audience: "agencies", competitors: ["Close"], topics: ["pricing"] },
  questions: Array.from({ length: questions }, (_, i) => ({ id: `q${i + 1}`, text: `Best CRM ${i + 1}?`, intent: "best-for" as const, topic: "pricing" })),
  models: ["claude", "gemini"],
  webSearch: true,
  estimateUsd: 0.4,
});
const answer = (questionId: string): TaskResult => ({
  type: "answer",
  answer: { questionId, model: "claude", text: "Try **Acme** — or Close.", citations: ["https://example.com/a"], source: "live", latencyMs: 812, costUsd: 0.05 },
});

describe.each(stores)("%s store", (_name, make) => {
  it("saves a run and loads it back", async () => {
    const store = make();
    const id = unique();
    const record = run(id, "2026-10-26");
    expect(await store.loadRun(id)).toBeNull();
    await store.saveRun(record);
    expect(await store.loadRun(id)).toEqual(record);
  });

  it("lets one request claim an answer, and hands the saved answer to anyone who asks after", async () => {
    const store = make();
    const id = unique();
    const now = Date.now();
    await store.saveRun(run(id, "2026-10-26"));
    expect(await store.claim(id, "claude:q1", now)).toEqual({ state: "claimed" });
    expect(await store.claim(id, "claude:q1", now + 10)).toEqual({ state: "busy" });
    await store.complete({ runId: id, task: "claude:q1", result: answer("q1"), costUsd: 0.05, day: unique(), now });
    expect(await store.claim(id, "claude:q1", now + 20)).toEqual({ state: "done", result: answer("q1") });
  });

  it("frees a claim nobody finished, so a crashed request can be retried", async () => {
    const store = make();
    const id = unique();
    const now = Date.now();
    await store.saveRun(run(id, "2026-10-26"));
    await store.claim(id, "claude:q1", now);
    expect(await store.claim(id, "claude:q1", now + CLAIM_MS + 1)).toEqual({ state: "claimed" });
  });

  it("books each answer's cost once, draws down the hold, and releases the rest", async () => {
    const store = make();
    const id = unique();
    const day = unique();
    const now = Date.now();
    await store.saveRun(run(id, day));
    expect(await store.hold({ day, runId: id, estimateUsd: 0.4, totalTasks: 4, limitUsd: 1, now })).toEqual({ ok: true, spentUsd: 0, heldUsd: 0.4 });
    const done = { runId: id, task: "claude:q1", result: answer("q1"), costUsd: 0.15, day, now };
    await store.complete(done);
    await store.complete(done);
    expect(await store.ledger(day, now)).toEqual({ spentUsd: 0.15, heldUsd: 0.25 });
    expect(await store.release(id, [day, day])).toEqual({ costUsd: 0.15 });
    expect(await store.ledger(day, now)).toEqual({ spentUsd: 0.15, heldUsd: 0 });
    expect(await store.release(id, [day])).toEqual({ costUsd: 0.15 });
  });

  it("refuses a new hold past the limit, counting every running check, but renews one it already has", async () => {
    const store = make();
    const day = unique();
    const [a, b] = [unique(), unique()];
    const now = Date.now();
    expect((await store.hold({ day, runId: a, estimateUsd: 0.7, totalTasks: 4, limitUsd: 1, now })).ok).toBe(true);
    expect(await store.hold({ day, runId: b, estimateUsd: 0.4, totalTasks: 4, limitUsd: 1, now })).toEqual({ ok: false, spentUsd: 0, heldUsd: 0.7 });
    expect((await store.hold({ day, runId: b, estimateUsd: 0, totalTasks: 4, limitUsd: 0, now })).ok).toBe(true);
    expect((await store.hold({ day, runId: a, estimateUsd: 5, totalTasks: 4, limitUsd: 1, now: now + 1 })).ok).toBe(true);
    expect((await store.hold({ day, runId: unique(), estimateUsd: 5, totalTasks: 4, limitUsd: null, now })).ok).toBe(true);
  });

  it("lets a hold lapse when its check goes quiet, and holds only what's left when the check comes back", async () => {
    const store = make();
    const id = unique();
    const day = unique();
    const now = Date.now();
    await store.saveRun(run(id, day));
    await store.hold({ day, runId: id, estimateUsd: 0.4, totalTasks: 4, limitUsd: 1, now });
    await store.complete({ runId: id, task: "claude:q1", result: answer("q1"), costUsd: 0.1, day, now });
    const later = now + HOLD_LEASE_MS + 1;
    expect(await store.ledger(day, later)).toEqual({ spentUsd: 0.1, heldUsd: 0 });
    expect(await store.hold({ day, runId: id, estimateUsd: 0.4, totalTasks: 4, limitUsd: 1, now: later })).toEqual({ ok: true, spentUsd: 0.1, heldUsd: 0.3 });
  });

  it("counts requests in a window that starts with the first one", async () => {
    const store = make();
    const key = unique();
    const now = Date.now();
    expect((await store.hit(key, 200, now)).count).toBe(1);
    const second = await store.hit(key, 200, now + 10);
    expect(second.count).toBe(2);
    expect(second.resetMs).toBeGreaterThan(0);
    expect(second.resetMs).toBeLessThanOrEqual(200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await store.hit(key, 200, now + 260)).count).toBe(1);
  });
});
