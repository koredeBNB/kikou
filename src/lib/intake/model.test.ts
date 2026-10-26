import { describe, expect, it } from "vitest";
import { callIntakeModel, callStructuredModel, resolveIntakeModel, type IntakeModelSetting } from "@/lib/intake/model";
import { INTAKE_JSON_SCHEMA } from "@/lib/intake/schema";
import { QUESTIONS_JSON_SCHEMA } from "@/lib/sov/generate";

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(body: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const bodyOf = (call: FetchCall) => JSON.parse(String(call.init.body));
const headersOf = (call: FetchCall) => new Headers(call.init.headers);
const prompt = { system: "You parse replies.", user: '{"reply":"Fernly"}' };
const turn = { intent: "answer", values: { product: "Fernly" }, asks: "category", message: "Hi!" };

describe("resolveIntakeModel", () => {
  it("uses rules when no key is set", () => {
    expect(resolveIntakeModel({})).toBeNull();
  });

  it("prefers OpenRouter with DeepSeek V4 Flash, overridable", () => {
    expect(resolveIntakeModel({ OPENROUTER_API_KEY: "or-key", OPENAI_API_KEY: "sk" })).toEqual({
      provider: "openrouter",
      apiKey: "or-key",
      model: "deepseek/deepseek-v4-flash",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(resolveIntakeModel({ OPENROUTER_API_KEY: "or-key", OPENROUTER_INTAKE_MODEL: "x/y" })?.model).toBe("x/y");
  });

  it("falls back to the cheapest model of the direct key that is set", () => {
    expect(resolveIntakeModel({ OPENAI_API_KEY: "sk" })).toMatchObject({ provider: "openai", model: "gpt-4.1-nano" });
    expect(resolveIntakeModel({ ANTHROPIC_API_KEY: "ak" })).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(resolveIntakeModel({ GOOGLE_API_KEY: "g" })).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash-lite" });
    expect(resolveIntakeModel({ GEMINI_API_KEY: "g", GEMINI_INTAKE_MODEL: "gemini-x" })?.model).toBe("gemini-x");
  });

  it("can be forced to rules", () => {
    expect(resolveIntakeModel({ OPENROUTER_API_KEY: "k", SOV_INTAKE_RULES: "true" })).toBeNull();
    expect(resolveIntakeModel({ OPENAI_API_KEY: "k", SOV_FORCE_MOCK: "1" })).toBeNull();
  });
});

describe("callIntakeModel", () => {
  const setting = (patch: Partial<IntakeModelSetting>): IntakeModelSetting => ({
    provider: "openrouter",
    apiKey: "or-key",
    model: "deepseek/deepseek-v4-flash",
    baseUrl: "https://openrouter.ai/api/v1",
    ...patch,
  });

  it("asks OpenRouter for strict JSON-schema output with reasoning off and reads the message content", async () => {
    const { impl, calls } = fakeFetch({ choices: [{ message: { content: JSON.stringify(turn) } }] });
    expect(await callIntakeModel(setting({}), prompt, { fetchImpl: impl })).toBe(JSON.stringify(turn));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headersOf(calls[0]).get("authorization")).toBe("Bearer or-key");
    expect(headersOf(calls[0]).get("x-title")).toBe("Kioku");
    expect(bodyOf(calls[0])).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "intake_turn", strict: true, schema: INTAKE_JSON_SCHEMA } },
      reasoning: { effort: "none" },
      provider: { require_parameters: true },
      temperature: 0,
    });
  });

  it("retries without the reasoning switch when no OpenRouter host accepts it", async () => {
    const calls: FetchCall[] = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return calls.length === 1
        ? new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found that can handle the requested parameters." } }), { status: 404 })
        : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(turn) } }] }), { status: 200 });
    }) as typeof fetch;

    expect(await callIntakeModel(setting({ model: "openai/gpt-4.1-nano" }), prompt, { fetchImpl: impl })).toBe(JSON.stringify(turn));
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]).reasoning).toBeUndefined();
    expect(bodyOf(calls[1])).toMatchObject({
      model: "openai/gpt-4.1-nano",
      response_format: { type: "json_schema", json_schema: { strict: true } },
      provider: { require_parameters: true },
    });
  });

  it("doesn't retry OpenRouter on other errors", async () => {
    const { impl, calls } = fakeFetch({ error: { message: "rate limited" } }, 429);
    await expect(callIntakeModel(setting({}), prompt, { fetchImpl: impl })).rejects.toThrow(/\(429\)/);
    expect(calls).toHaveLength(1);
  });

  it("uses OpenAI's own endpoint with the same structured output", async () => {
    const { impl, calls } = fakeFetch({ choices: [{ message: { content: "{}" } }] });
    await callIntakeModel(setting({ provider: "openai", apiKey: "sk", model: "gpt-4.1-nano", baseUrl: undefined }), prompt, {
      fetchImpl: impl,
    });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(bodyOf(calls[0]).response_format.type).toBe("json_schema");
    expect(bodyOf(calls[0]).provider).toBeUndefined();
  });

  it("forces an Anthropic tool call and returns its input", async () => {
    const { impl, calls } = fakeFetch({ content: [{ type: "tool_use", name: "record_intake", input: turn }] });
    const raw = await callIntakeModel(setting({ provider: "anthropic", apiKey: "ak", model: "claude-haiku-4-5", baseUrl: undefined }), prompt, {
      fetchImpl: impl,
    });
    expect(raw).toEqual(turn);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(headersOf(calls[0]).get("x-api-key")).toBe("ak");
    expect(bodyOf(calls[0])).toMatchObject({
      system: prompt.system,
      tool_choice: { type: "tool", name: "record_intake" },
      tools: [{ name: "record_intake", input_schema: INTAKE_JSON_SCHEMA }],
    });
  });

  it("asks Gemini for a JSON response schema", async () => {
    const { impl, calls } = fakeFetch({ candidates: [{ content: { parts: [{ text: JSON.stringify(turn) }] } }] });
    const raw = await callIntakeModel(setting({ provider: "gemini", apiKey: "g", model: "gemini-2.5-flash-lite", baseUrl: undefined }), prompt, {
      fetchImpl: impl,
    });
    expect(raw).toBe(JSON.stringify(turn));
    expect(calls[0].url).toContain("/models/gemini-2.5-flash-lite:generateContent");
    const body = bodyOf(calls[0]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: prompt.system }] });
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 });
    expect(body.generationConfig.responseSchema.properties.values.properties.product).toEqual({ type: "STRING", nullable: true });
  });

  it("sends another task's schema, name, temperature and output budget when asked", async () => {
    const spec = { name: "buyer_questions", schema: QUESTIONS_JSON_SCHEMA, maxTokens: 2000, temperature: 0.8 };
    const { impl, calls } = fakeFetch({ choices: [{ message: { content: '{"questions":["Which CRM?"]}' } }] });
    expect(await callStructuredModel(setting({}), prompt, spec, { fetchImpl: impl })).toBe('{"questions":["Which CRM?"]}');
    expect(bodyOf(calls[0])).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "buyer_questions", strict: true, schema: QUESTIONS_JSON_SCHEMA } },
      reasoning: { effort: "none" },
      max_tokens: 2000,
      temperature: 0.8,
    });

    const anthropic = fakeFetch({ content: [{ type: "tool_use", name: "buyer_questions", input: { questions: ["Which CRM?"] } }] });
    const raw = await callStructuredModel(setting({ provider: "anthropic", apiKey: "ak", model: "claude-haiku-4-5", baseUrl: undefined }), prompt, spec, {
      fetchImpl: anthropic.impl,
    });
    expect(raw).toEqual({ questions: ["Which CRM?"] });
    expect(bodyOf(anthropic.calls[0])).toMatchObject({ max_tokens: 2000, tool_choice: { name: "buyer_questions" } });
  });

  it("throws on an error status without leaking the key", async () => {
    const { impl } = fakeFetch({ error: { message: "bad key or-key" } }, 401);
    await expect(callIntakeModel(setting({}), prompt, { fetchImpl: impl })).rejects.toThrow(/intake model request failed \(401\)/i);
    await expect(callIntakeModel(setting({}), prompt, { fetchImpl: impl })).rejects.not.toThrow(/or-key/);
  });
});
