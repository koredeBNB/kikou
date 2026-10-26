import { INTAKE_JSON_SCHEMA } from "@/lib/intake/schema";
import { truthy, type Env } from "@/lib/providers/config";

export type IntakeProvider = "openrouter" | "openai" | "anthropic" | "gemini";

export interface IntakeModelSetting {
  provider: IntakeProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface IntakeCallOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export type IntakeClient = (
  setting: IntakeModelSetting,
  prompt: { system: string; user: string },
  options?: IntakeCallOptions,
) => Promise<unknown>;

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_OUTPUT_TOKENS = 400;
const TOOL_NAME = "record_intake";

/** Cheapest fast, non-reasoning model per provider, in order of preference. */
const CANDIDATES: { provider: IntakeProvider; keys: string[]; modelVar: string; model: string }[] = [
  { provider: "openrouter", keys: ["OPENROUTER_API_KEY"], modelVar: "OPENROUTER_INTAKE_MODEL", model: "deepseek/deepseek-v3.2" },
  { provider: "openai", keys: ["OPENAI_API_KEY"], modelVar: "OPENAI_INTAKE_MODEL", model: "gpt-4.1-nano" },
  { provider: "anthropic", keys: ["ANTHROPIC_API_KEY"], modelVar: "ANTHROPIC_INTAKE_MODEL", model: "claude-haiku-4-5" },
  { provider: "gemini", keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], modelVar: "GEMINI_INTAKE_MODEL", model: "gemini-2.5-flash-lite" },
];

export function intakeRulesForced(env: Env): boolean {
  return truthy(env.SOV_INTAKE_RULES) || truthy(env.SOV_FORCE_MOCK);
}

export function resolveIntakeModel(env: Env): IntakeModelSetting | null {
  if (intakeRulesForced(env)) return null;
  for (const candidate of CANDIDATES) {
    const apiKey = candidate.keys.map((k) => env[k]?.trim()).find(Boolean);
    if (!apiKey) continue;
    const model = env[candidate.modelVar]?.trim() || candidate.model;
    return candidate.provider === "openrouter"
      ? { provider: "openrouter", apiKey, model, baseUrl: env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL }
      : { provider: candidate.provider, apiKey, model };
  }
  return null;
}

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

async function postJson(url: string, headers: Record<string, string>, body: unknown, options: IntakeCallOptions): Promise<Json> {
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Intake model request failed (${response.status})`);
  return (await response.json()) as Json;
}

type Schema = Record<string, unknown>;

/** Gemini's response schema is an OpenAPI subset: upper-case types, `nullable` instead of type unions. */
function toGeminiSchema(schema: Schema): Schema {
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  const type = types.find((t) => t !== "null") ?? "string";
  const out: Schema = { type: type.toUpperCase() };
  if (types.includes("null")) out.nullable = true;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items as Schema);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Schema>).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
    out.required = schema.required;
  }
  return out;
}

export const callIntakeModel: IntakeClient = async (setting, prompt, options = {}) => {
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  const responseFormat = { type: "json_schema", json_schema: { name: "intake_turn", strict: true, schema: INTAKE_JSON_SCHEMA } };

  switch (setting.provider) {
    case "openrouter": {
      const data = await postJson(
        `${setting.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`,
        { authorization: `Bearer ${setting.apiKey}`, "x-title": "Meadowlark" },
        {
          model: setting.model,
          messages,
          response_format: responseFormat,
          provider: { require_parameters: true },
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
        },
        options,
      );
      return (asArray(data.choices)[0]?.message as Json | undefined)?.content;
    }
    case "openai": {
      const data = await postJson(
        "https://api.openai.com/v1/chat/completions",
        { authorization: `Bearer ${setting.apiKey}` },
        { model: setting.model, messages, response_format: responseFormat, temperature: 0, max_completion_tokens: MAX_OUTPUT_TOKENS },
        options,
      );
      return (asArray(data.choices)[0]?.message as Json | undefined)?.content;
    }
    case "anthropic": {
      const data = await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": setting.apiKey, "anthropic-version": "2023-06-01" },
        {
          model: setting.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          tools: [{ name: TOOL_NAME, description: "Record how the reply was understood.", input_schema: INTAKE_JSON_SCHEMA }],
          tool_choice: { type: "tool", name: TOOL_NAME },
        },
        options,
      );
      return asArray(data.content).find((block) => block.type === "tool_use" && block.name === TOOL_NAME)?.input;
    }
    case "gemini": {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setting.model)}:generateContent`,
        { "x-goog-api-key": setting.apiKey },
        {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(INTAKE_JSON_SCHEMA),
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        },
        options,
      );
      const parts = asArray((asArray(data.candidates)[0]?.content as Json | undefined)?.parts);
      return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
    }
  }
};
