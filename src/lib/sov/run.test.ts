import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/lib/sov/events";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import { runCheck } from "@/lib/sov/run";
import { MODEL_IDS } from "@/lib/sov/types";

const brief = normalizeBrief({ product: "Acme", category: "CRM", audience: "small agencies", competitors: ["Close"] });
const questions = generateQuestions(brief, { year: 2026 }).slice(0, 3);
const noDelay = async () => {};

async function collect(options: Partial<Parameters<typeof runCheck>[0]> = {}) {
  const events: RunEvent[] = [];
  await runCheck(
    { brief, questions, models: [...MODEL_IDS], env: {}, delay: noDelay, ...options },
    (event) => events.push(event),
  );
  return events;
}

describe("runCheck", () => {
  it("streams a start event, one answer per question and model, then done", async () => {
    const events = await collect();
    expect(events[0]).toMatchObject({ type: "start", total: 12 });
    const start = events[0] as Extract<RunEvent, { type: "start" }>;
    expect(start.models.every((m) => m.source === "mock")).toBe(true);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(12);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("only asks the selected models", async () => {
    const events = await collect({ models: ["claude"] });
    const answers = events.filter((e) => e.type === "answer");
    expect(answers).toHaveLength(3);
    expect(answers.every((e) => e.type === "answer" && e.answer.model === "claude")).toBe(true);
  });

  it("reports provider failures per answer and keeps going", async () => {
    const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const events = await collect({ env: { OPENAI_API_KEY: "sk-test" }, fetchImpl: failing });
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.type === "error" && e.model === "chatgpt" && e.message.includes("500"))).toBe(true);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(9);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("passes on what each live answer cost and totals the check when done", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Try **Acme**." } }], usage: { cost: 0.01 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const events = await collect({ env: { OPENROUTER_API_KEY: "or" }, fetchImpl: ok, models: ["claude", "gemini"] });
    const answers = events.flatMap((e) => (e.type === "answer" ? [e.answer] : []));
    expect(answers).toHaveLength(6);
    expect(answers.every((a) => a.costUsd === 0.01)).toBe(true);
    const done = events.at(-1);
    expect(done?.type === "done" && done.costUsd).toBeCloseTo(0.06, 6);
  });

  it("costs nothing in demo mode", async () => {
    const done = (await collect()).at(-1);
    expect(done?.type === "done" && done.costUsd).toBe(0);
  });

  it("can switch web search off for one check", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const env = { OPENROUTER_API_KEY: "or" };
    await collect({ env, fetchImpl: capture, models: ["chatgpt"], questions: questions.slice(0, 1) });
    expect(bodies[0].plugins).toEqual([{ id: "web" }]);
    await collect({ env, fetchImpl: capture, models: ["chatgpt"], questions: questions.slice(0, 1), webSearch: false });
    expect(bodies[1].plugins).toBeUndefined();
  });

  it("keeps a few requests in flight per assistant, with the assistants running side by side", async () => {
    const inFlight: Record<string, number> = {};
    const peak: Record<string, number> = {};
    let overallPeak = 0;
    const slow = (async (_url: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      inFlight[model] = (inFlight[model] ?? 0) + 1;
      peak[model] = Math.max(peak[model] ?? 0, inFlight[model]);
      overallPeak = Math.max(overallPeak, Object.values(inFlight).reduce((a, b) => a + b, 0));
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight[model]--;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `q${i + 1}`, text: `Question ${i + 1}?`, intent: "custom" as const }));
    const events = await collect({ env: { OPENROUTER_API_KEY: "or" }, fetchImpl: slow, questions: many, concurrency: 2 });
    expect(events.filter((e) => e.type === "answer")).toHaveLength(32);
    expect(Object.values(peak).every((n) => n <= 2)).toBe(true);
    expect(overallPeak).toBeGreaterThan(2);
  });

  it("retries rate limits and server errors, waiting as long as the provider asks", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "3" } });
      if (calls === 2) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const events = await collect({
      env: { OPENROUTER_API_KEY: "or" },
      fetchImpl: flaky,
      models: ["claude"],
      questions: questions.slice(0, 1),
      delay: async (ms) => {
        waits.push(ms);
      },
    });
    expect(calls).toBe(3);
    expect(waits).toEqual([3000, 4000]);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("gives up after three retries and lists the answer as failed", async () => {
    let calls = 0;
    const down = (async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as unknown as typeof fetch;
    const events = await collect({ env: { OPENROUTER_API_KEY: "or" }, fetchImpl: down, models: ["claude"], questions: questions.slice(0, 1) });
    expect(calls).toBe(4);
    expect(events.find((e) => e.type === "error")).toMatchObject({ model: "claude", questionId: questions[0].id, message: "Claude request failed (503)" });
  });

  it("doesn't retry requests the provider rejected outright", async () => {
    let calls = 0;
    const refused = (async () => {
      calls++;
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    await collect({ env: { OPENROUTER_API_KEY: "or" }, fetchImpl: refused, models: ["claude"], questions: questions.slice(0, 1) });
    expect(calls).toBe(1);
  });

  it("retries a slow answer once before giving up on it", async () => {
    let calls = 0;
    const hang = ((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const events = await collect({
      env: { OPENROUTER_API_KEY: "or" },
      fetchImpl: hang,
      models: ["chatgpt"],
      questions: questions.slice(0, 1),
      timeoutMs: 15,
    });
    expect(calls).toBe(2);
    expect(events.find((e) => e.type === "error")).toMatchObject({ message: "ChatGPT took too long to answer" });
  });

  it("sends heartbeats while answers are slow, so proxies keep the stream open", async () => {
    const slow = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const events = await collect({ env: { OPENROUTER_API_KEY: "or" }, fetchImpl: slow, models: ["claude"], questions: questions.slice(0, 1), heartbeatMs: 10 });
    expect(events.filter((e) => e.type === "ping").length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("marks live answers as live", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Try **Acme**." } }], citations: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const events = await collect({ env: { PERPLEXITY_API_KEY: "p" }, fetchImpl: ok, models: ["perplexity"] });
    const answer = events.find((e) => e.type === "answer");
    expect(answer?.type === "answer" && answer.answer.source).toBe("live");
  });
});
