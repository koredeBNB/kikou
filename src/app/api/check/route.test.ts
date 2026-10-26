import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/check/route";
import { spendLedger } from "@/lib/sov/budget";
import { ANSWER_RATES, formatUsd } from "@/lib/sov/estimate";

const question = (i: number) => ({ id: `q${i}`, text: `What's the best CRM for small agencies, take ${i}?`, intent: "best-for" });
const body = {
  brief: { product: "Acme", category: "CRM", audience: "small agencies", competitors: [] },
  questions: [question(1)],
  models: ["claude"],
};
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/check", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }));

const openRouterAnswer = (cost: number) =>
  vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Try Acme." } }], usage: { cost } }), { status: 200 });
  });

beforeEach(() => {
  Object.assign(spendLedger(), { day: "", spentUsd: 0, reservedUsd: 0 });
  vi.stubEnv("SOV_FORCE_MOCK", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/check daily budget", () => {
  it("reserves the estimate at the start and records the actual cost at the end", async () => {
    vi.stubGlobal("fetch", openRouterAnswer(0.002));
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(spendLedger().reservedUsd).toBeCloseTo(ANSWER_RATES.claude.search.costUsd, 6);
    await response.text();
    await vi.waitFor(() => expect(spendLedger().reservedUsd).toBe(0));
    expect(spendLedger().spentUsd).toBeCloseTo(0.002, 6);
  });

  it("blocks a check whose estimate is more than what's left today, with a 429 and a friendly message", async () => {
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0.05");
    vi.stubGlobal("fetch", openRouterAnswer(0.01));
    const response = await post({ ...body, models: ["chatgpt", "claude", "gemini", "perplexity"] });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const json = await response.json();
    expect(json.code).toBe("daily-budget");
    const estimate = formatUsd(Object.values(ANSWER_RATES).reduce((sum, rate) => sum + rate.search.costUsd, 0));
    expect(json.error).toMatch(new RegExp(`^That check would cost about \\${estimate}, but only \\$0\\.05 of today's \\$0\\.05 budget is left\\.`));
    expect(spendLedger().reservedUsd).toBe(0);
  });

  it("lets a smaller check through once a big one is refused", async () => {
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0.05");
    vi.stubGlobal("fetch", openRouterAnswer(0.01));
    expect((await post({ ...body, models: ["chatgpt", "claude", "gemini", "perplexity"] })).status).toBe(429);
    const small = await post(body);
    expect(small.status).toBe(200);
    await small.text();
  });

  it("releases the reservation when the browser goes away mid-check", async () => {
    vi.stubGlobal("fetch", openRouterAnswer(0.002));
    const response = await post({ ...body, questions: [question(1), question(2), question(3)] });
    await response.body?.cancel();
    await vi.waitFor(() => expect(spendLedger().reservedUsd).toBe(0));
  });

  it("never blocks free demo checks", async () => {
    vi.stubEnv("SOV_FORCE_MOCK", "true");
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0");
    const response = await post(body);
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("doesn't reserve anything for requests that fail validation", async () => {
    expect((await post({ brief: {} })).status).toBe(400);
    expect(spendLedger()).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });
});
