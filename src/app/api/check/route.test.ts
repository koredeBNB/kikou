import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as batch } from "@/app/api/check/[id]/batch/route";
import { POST as finish } from "@/app/api/check/[id]/finish/route";
import { POST as start } from "@/app/api/check/route";
import { budgetStatus } from "@/lib/sov/budget";
import { ANSWER_RATES, formatUsd } from "@/lib/sov/estimate";
import type { BatchEvent, CheckStarted } from "@/lib/sov/events";
import { checkStore } from "@/lib/store";

const question = (i: number) => ({ id: `q${i}`, text: `What's the best CRM for small agencies, take ${i}?`, intent: "best-for" });
const body = {
  brief: { product: "Acme", category: "CRM", audience: "small agencies", competitors: [] },
  questions: [question(1)],
  models: ["claude"],
};
const json = (payload: unknown, ip = "203.0.113.7") =>
  ({ method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json", "x-real-ip": ip } }) as const;
const post = (payload: unknown, ip?: string) => start(new Request("http://localhost/api/check", json(payload, ip)));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const askBatch = (id: string, tasks: unknown) => batch(new Request(`http://localhost/api/check/${id}/batch`, json({ tasks })), params(id));
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BatchEvent)
    .filter((event) => event.type !== "ping");
const ledger = async () => (await budgetStatus(process.env, checkStore()))!;

const openRouterAnswer = (cost: number) =>
  vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Try Acme." } }], usage: { cost } }), { status: 200 });
  });

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("kioku.memory-store")];
  vi.stubEnv("SOV_FORCE_MOCK", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "1");
  vi.stubEnv("SOV_CHECKS_PER_HOUR", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a check in batches", () => {
  it("holds the estimate at the start, books each answer's real cost, and releases the rest at the end", async () => {
    const fetchMock = openRouterAnswer(0.002);
    vi.stubGlobal("fetch", fetchMock);
    const response = await post({ ...body, questions: [question(1), question(2)] });
    expect(response.status).toBe(200);
    const started = (await response.json()) as CheckStarted;
    expect(started).toMatchObject({ total: 2, models: [{ id: "claude", source: "live" }] });
    expect((await ledger()).reservedUsd).toBeCloseTo(2 * ANSWER_RATES.claude.search.costUsd, 6);

    const events = await lines(await askBatch(started.runId, [{ model: "claude", questionId: "q1" }, { model: "claude", questionId: "q2" }]));
    expect(events.map((e) => e.type)).toEqual(["answer", "answer"]);
    expect((await ledger()).spentUsd).toBeCloseTo(0.004, 6);

    const done = await (await finish(new Request("http://localhost", { method: "POST" }), params(started.runId))).json();
    expect(done.costUsd).toBeCloseTo(0.004, 6);
    expect(await ledger()).toMatchObject({ reservedUsd: 0 });
  });

  it("answers a repeated batch from storage, without asking the assistant or paying again", async () => {
    const fetchMock = openRouterAnswer(0.002);
    vi.stubGlobal("fetch", fetchMock);
    const { runId } = (await (await post(body)).json()) as CheckStarted;
    const task = [{ model: "claude", questionId: "q1" }];
    const first = await lines(await askBatch(runId, task));
    const again = await lines(await askBatch(runId, task));
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await ledger()).spentUsd).toBeCloseTo(0.002, 6);
  });

  it("only answers questions and assistants that belong to the check", async () => {
    vi.stubGlobal("fetch", openRouterAnswer(0.002));
    const { runId } = (await (await post(body)).json()) as CheckStarted;
    expect((await askBatch(runId, [{ model: "gemini", questionId: "q1" }])).status).toBe(400);
    expect((await askBatch(runId, [{ model: "claude", questionId: "q9" }])).status).toBe(400);
    expect((await askBatch(runId, Array.from({ length: 6 }, () => ({ model: "claude", questionId: "q1" })))).status).toBe(400);
    const missing = await askBatch("nope", [{ model: "claude", questionId: "q1" }]);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("run-missing");
  });

  it("blocks a check whose estimate is more than what's left today, with a 429 and a friendly message", async () => {
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0.05");
    const response = await post({ ...body, models: ["chatgpt", "claude", "gemini", "perplexity"] });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const refused = await response.json();
    expect(refused.code).toBe("daily-budget");
    const estimate = formatUsd(Object.values(ANSWER_RATES).reduce((sum, rate) => sum + rate.search.costUsd, 0));
    expect(refused.error).toMatch(new RegExp(`^That check would cost about \\${estimate}, but only \\$0\\.05 of today's \\$0\\.05 budget is left\\.`));
    expect((await ledger()).reservedUsd).toBe(0);
    expect((await post(body)).status).toBe(200);
  });

  it("counts every running check's hold, so two checks can't both spend the same budget", async () => {
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0.02");
    expect((await post(body)).status).toBe(200);
    expect((await post({ ...body, brief: { ...body.brief, product: "Beta" } })).status).toBe(429);
  });

  it("limits how many checks one visitor can start in an hour", async () => {
    vi.stubEnv("SOV_CHECKS_PER_HOUR", "2");
    vi.stubEnv("SOV_FORCE_MOCK", "true");
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const third = await post(body);
    expect(third.status).toBe(429);
    expect((await third.json()).code).toBe("rate-limit");
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(body, "198.51.100.4")).status).toBe(200);
  });

  it("never blocks free demo checks", async () => {
    vi.stubEnv("SOV_FORCE_MOCK", "true");
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0");
    const response = await post(body);
    expect(response.status).toBe(200);
    const { runId } = (await response.json()) as CheckStarted;
    const events = await lines(await askBatch(runId, [{ model: "claude", questionId: "q1" }]));
    expect(events[0]).toMatchObject({ type: "answer", answer: { source: "mock" } });
  });

  it("doesn't hold or count anything for requests that fail validation", async () => {
    vi.stubEnv("SOV_CHECKS_PER_HOUR", "1");
    expect((await post({ brief: {} })).status).toBe(400);
    expect(await ledger()).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
    expect((await post(body)).status).toBe(200);
  });

  it("refuses to run on Vercel without Redis, since in-process state isn't shared between instances", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    const response = await post(body);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/no Redis store/);
  });
});
