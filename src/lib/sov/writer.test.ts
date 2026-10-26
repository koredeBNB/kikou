import { describe, expect, it } from "vitest";
import type { IntakeModelSetting } from "@/lib/intake/model";
import { QUESTIONS_JSON_SCHEMA, type GenerationRequest } from "@/lib/sov/generate";
import { modelQuestionWriter, questionsTimeout, QUESTIONS_TIMEOUT_MS } from "@/lib/sov/writer";

const setting: IntakeModelSetting = { provider: "openrouter", apiKey: "or-key", model: "deepseek/deepseek-v4-flash", baseUrl: "https://openrouter.ai/api/v1" };
const request: GenerationRequest = {
  category: "crypto wallet",
  audience: "",
  competitors: [],
  product: "Trust Wallet",
  angle: "a mix",
  count: 10,
  avoid: [],
};

describe("questionsTimeout", () => {
  it("defaults to 40 seconds and can be overridden", () => {
    expect(questionsTimeout({})).toBe(QUESTIONS_TIMEOUT_MS);
    expect(QUESTIONS_TIMEOUT_MS).toBe(40_000);
    expect(questionsTimeout({ SOV_QUESTIONS_TIMEOUT_MS: "15000" })).toBe(15_000);
    expect(questionsTimeout({ SOV_QUESTIONS_TIMEOUT_MS: "soon" })).toBe(QUESTIONS_TIMEOUT_MS);
  });
});

describe("modelQuestionWriter", () => {
  it("asks the model for a JSON list of questions with some variety and returns the list", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"questions":["Which wallet is safest?"]}' } }] }), { status: 200 });
    }) as typeof fetch;
    const write = modelQuestionWriter(setting, { fetchImpl, timeoutMs: 1000 });

    expect(await write(request)).toEqual(["Which wallet is safest?"]);
    expect(sent).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      response_format: { json_schema: { name: "buyer_questions", schema: QUESTIONS_JSON_SCHEMA } },
    });
    expect(sent.temperature).toBeGreaterThan(0);
    expect(String((sent.messages as { content: string }[])[0].content)).toContain("Never mention “Trust Wallet”");
  });

  it("gives up when the model is too slow", async () => {
    const fetchImpl = ((_url: string | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const write = modelQuestionWriter(setting, { fetchImpl, timeoutMs: 20 });
    await expect(write(request)).rejects.toThrow();
  });
});
