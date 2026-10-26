import { describe, expect, it } from "vitest";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import { answerTask, MIN_ATTEMPT_MS, type AnswerOptions } from "@/lib/sov/run";
import type { ModelId } from "@/lib/sov/types";

const brief = normalizeBrief({ product: "Acme", category: "CRM", audience: "small agencies", competitors: ["Close"] });
const question = generateQuestions(brief, { year: 2026 })[0];
const noDelay = async () => {};

const ask = (model: ModelId, options: Partial<AnswerOptions> = {}) => answerTask(model, question, { brief, env: {}, delay: noDelay, ...options });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("answerTask", () => {
  it("answers with demo text for free when the assistant has no key", async () => {
    const { result, costUsd } = await ask("claude");
    expect(result).toMatchObject({ type: "answer", answer: { model: "claude", questionId: question.id, source: "mock" } });
    expect(costUsd).toBe(0);
  });

  it("reports a provider failure as a failed answer", async () => {
    const failing = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const { result, costUsd } = await ask("chatgpt", { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl: failing });
    expect(result).toEqual({ type: "error", model: "chatgpt", questionId: question.id, message: "ChatGPT request failed (401)" });
    expect(costUsd).toBe(0);
  });

  it("passes on what a live answer cost", async () => {
    const ok = (async () => reply({ choices: [{ message: { content: "Try **Acme**." } }], usage: { cost: 0.01 } })) as unknown as typeof fetch;
    const { result, costUsd } = await ask("gemini", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: ok });
    expect(result.type === "answer" && result.answer).toMatchObject({ source: "live", costUsd: 0.01 });
    expect(costUsd).toBe(0.01);
  });

  it("can switch web search off for one check", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return reply({ choices: [{ message: { content: "ok" } }] });
    }) as unknown as typeof fetch;
    const env = { OPENROUTER_API_KEY: "or" };
    await ask("chatgpt", { env, fetchImpl: capture });
    expect(bodies[0].plugins).toEqual([{ id: "web" }]);
    await ask("chatgpt", { env, fetchImpl: capture, webSearch: false });
    expect(bodies[1].plugins).toBeUndefined();
  });

  it("retries rate limits and server errors, waiting as long as the provider asks", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "3" } });
      if (calls === 2) return new Response("{}", { status: 503 });
      return reply({ choices: [{ message: { content: "ok" } }] });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const { result } = await ask("claude", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: flaky, delay: async (ms) => void waits.push(ms) });
    expect(calls).toBe(3);
    expect(waits).toEqual([3000, 4000]);
    expect(result.type).toBe("answer");
  });

  it("gives up after three retries and returns the answer as failed", async () => {
    let calls = 0;
    const down = (async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as unknown as typeof fetch;
    const { result } = await ask("claude", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: down });
    expect(calls).toBe(4);
    expect(result).toMatchObject({ type: "error", model: "claude", questionId: question.id, message: "Claude request failed (503)" });
  });

  it("doesn't retry requests the provider rejected outright", async () => {
    let calls = 0;
    const refused = (async () => {
      calls++;
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    await ask("claude", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: refused });
    expect(calls).toBe(1);
  });

  it("retries a slow answer once before giving up on it", async () => {
    let calls = 0;
    const hang = ((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const { result } = await ask("chatgpt", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: hang, timeoutMs: 15 });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ type: "error", message: "ChatGPT took too long to answer" });
  });

  it("cuts an attempt short to fit the deadline", async () => {
    const started = Date.now();
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    const { result } = await ask("chatgpt", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: hang, deadline: started + 30 });
    expect(result).toMatchObject({ type: "error", message: "ChatGPT took too long to answer" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("doesn't start a retry it has no time to finish", async () => {
    let calls = 0;
    const busy = (async () => {
      calls++;
      return new Response("{}", { status: 429, headers: { "retry-after": "5" } });
    }) as unknown as typeof fetch;
    const { result } = await ask("claude", { env: { OPENROUTER_API_KEY: "or" }, fetchImpl: busy, deadline: Date.now() + MIN_ATTEMPT_MS + 2000 });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ type: "error", message: "Claude request failed (429)" });
  });

  it("marks live answers as live", async () => {
    const ok = (async () => reply({ choices: [{ message: { content: "Try **Acme**." } }], citations: [] })) as unknown as typeof fetch;
    const { result } = await ask("perplexity", { env: { PERPLEXITY_API_KEY: "p" }, fetchImpl: ok });
    expect(result.type === "answer" && result.answer.source).toBe("live");
  });
});
