import { describe, expect, it } from "vitest";
import { answerBatch, prepareBatch, startCheck } from "@/lib/sov/checks";
import type { BatchEvent, CheckStarted } from "@/lib/sov/events";
import { createMemoryStore } from "@/lib/store/memory";

const body = {
  brief: { product: "Acme", category: "CRM", audience: "small agencies", competitors: [] },
  questions: [{ id: "q1", text: "What's the best CRM for small agencies?", intent: "best-for" }],
  models: ["claude"],
};
const env = { OPENROUTER_API_KEY: "or" };
const task = { tasks: [{ model: "claude", questionId: "q1" }] };

async function begin(store = createMemoryStore()) {
  const started = await startCheck(body, new Headers(), { env, store });
  if (!started.ok) throw new Error(started.body.error);
  const prepared = await prepareBatch((started as { started: CheckStarted }).started.runId, task, { env, store });
  if (!prepared.ok) throw new Error(prepared.body.error);
  return { store, prepared };
}

const slowAnswer = (ms: number, calls: { n: number }) =>
  (async () => {
    calls.n++;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return Response.json({ choices: [{ message: { content: "Try Acme." } }], usage: { cost: 0.01 } });
  }) as unknown as typeof fetch;

describe("answerBatch", () => {
  it("waits for an answer another request is already fetching, instead of paying for it twice", async () => {
    const { store, prepared } = await begin();
    const calls = { n: 0 };
    const fetchImpl = slowAnswer(30, calls);
    const first: BatchEvent[] = [];
    const second: BatchEvent[] = [];
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    await Promise.all([
      answerBatch(prepared, { env, store, fetchImpl, delay }, (e) => first.push(e)),
      answerBatch(prepared, { env, store, fetchImpl, delay }, (e) => second.push(e)),
    ]);
    expect(calls.n).toBe(1);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({ type: "answer", answer: { questionId: "q1", costUsd: 0.01 } });
    expect((await store.ledger(new Date().toISOString().slice(0, 10), Date.now())).spentUsd).toBeCloseTo(0.01, 6);
  });

  it("gives up waiting on another request's answer when its own time runs out", async () => {
    const { store, prepared } = await begin();
    await store.claim(prepared.run.id, "claude:q1", Date.now());
    let clock = Date.now();
    const events: BatchEvent[] = [];
    await answerBatch(prepared, { env, store, now: () => clock, delay: async (ms) => void (clock += ms), budgetMs: 20_000 }, (e) => events.push(e));
    expect(events).toEqual([{ type: "error", model: "claude", questionId: "q1", message: "This answer was still on its way when time ran out." }]);
  });

  it("sends heartbeats while an answer is slow", async () => {
    const { store, prepared } = await begin();
    const events: BatchEvent[] = [];
    await answerBatch(prepared, { env, store, fetchImpl: slowAnswer(40, { n: 0 }), heartbeatMs: 10 }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "ping").length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("answer");
  });
});
