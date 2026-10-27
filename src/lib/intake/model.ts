import { BRAND_NAME } from "@/lib/brand";
import { INTAKE_JSON_SCHEMA } from "@/lib/intake/schema";
import { OPENROUTER_BASE_URL, truthy, type Env } from "@/lib/providers/config";

export type IntakeProvider = "openrouter" | "openai" | "anthropic" | "gemini";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
const EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"];

export interface IntakeModelSetting {
  provider: IntakeProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** OpenRouter only. "none" switches thinking off where the model allows it. */
  reasoning?: ReasoningEffort;
  /** OpenRouter only: models to try, in order, when the first one is down or rate-limited. */
  fallbackModels?: string[];
}

export interface IntakeCallOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Gets what the request cost in US dollars, when the provider says. */
  onCost?: (usd: number) => void;
}

/** `context`, when set, goes in a message of its own before `user`. */
export interface ModelPrompt {
  system: string;
  user: string;
  context?: string;
}

export type IntakeClient = (setting: IntakeModelSetting, prompt: ModelPrompt, options?: IntakeCallOptions) => Promise<unknown>;

/** One structured-output task: the JSON schema to fill, and how much room and randomness it gets. */
export interface StructuredSpec {
  name: string;
  /** Anthropic tool name, when it differs from `name`. */
  toolName?: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  /** OpenRouter only: search the web first and hand the model this many results. */
  webResults?: number;
}

const INTAKE_SPEC: StructuredSpec = { name: "intake_turn", toolName: "record_intake", schema: INTAKE_JSON_SCHEMA, maxTokens: 400, temperature: 0 };

/**
 * Cheapest fast model per provider, in order of preference. Gemini 3.5 Flash Lite can't switch reasoning
 * off, but at "low" it answers in about a second without thinking; 3.1 Flash Lite covers its rate limits.
 */
const CANDIDATES: { provider: IntakeProvider; keys: string[]; modelVar: string; model: string; reasoning?: ReasoningEffort; fallbacks?: string[] }[] = [
  {
    provider: "openrouter",
    keys: ["OPENROUTER_API_KEY"],
    modelVar: "OPENROUTER_INTAKE_MODEL",
    model: "google/gemini-3.5-flash-lite",
    reasoning: "low",
    fallbacks: ["google/gemini-3.1-flash-lite"],
  },
  { provider: "openai", keys: ["OPENAI_API_KEY"], modelVar: "OPENAI_INTAKE_MODEL", model: "gpt-4.1-nano" },
  { provider: "anthropic", keys: ["ANTHROPIC_API_KEY"], modelVar: "ANTHROPIC_INTAKE_MODEL", model: "claude-haiku-4-5" },
  { provider: "gemini", keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], modelVar: "GEMINI_INTAKE_MODEL", model: "gemini-2.5-flash-lite" },
];

export function intakeRulesForced(env: Env): boolean {
  return truthy(env.SOV_INTAKE_RULES) || truthy(env.SOV_FORCE_MOCK);
}

/** `OPENROUTER_INTAKE_REASONING` wins; a model picked with `OPENROUTER_INTAKE_MODEL` starts with reasoning off. */
function reasoningFor(env: Env, custom: boolean, preset?: ReasoningEffort): ReasoningEffort {
  const raw = env.OPENROUTER_INTAKE_REASONING?.trim().toLowerCase() as ReasoningEffort | undefined;
  if (raw && EFFORTS.includes(raw)) return raw;
  return custom ? "none" : (preset ?? "none");
}

export function resolveIntakeModel(env: Env): IntakeModelSetting | null {
  if (intakeRulesForced(env)) return null;
  for (const candidate of CANDIDATES) {
    const apiKey = candidate.keys.map((k) => env[k]?.trim()).find(Boolean);
    if (!apiKey) continue;
    const custom = env[candidate.modelVar]?.trim();
    const model = custom || candidate.model;
    if (candidate.provider !== "openrouter") return { provider: candidate.provider, apiKey, model };
    const setting: IntakeModelSetting = {
      provider: "openrouter",
      apiKey,
      model,
      baseUrl: env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
      reasoning: reasoningFor(env, Boolean(custom), candidate.reasoning),
    };
    if (!custom && candidate.fallbacks) setting.fallbackModels = candidate.fallbacks;
    return setting;
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
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RequestFailed(response.status, /reasoning is mandatory/i.test(detail));
  }
  return (await response.json()) as Json;
}

/** The message never includes the response body, which could echo request details. */
class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly needsReasoning = false,
  ) {
    super(`Intake model request failed (${status})`);
  }
}

function reportCost(data: Json, options: IntakeCallOptions) {
  const cost = (data.usage as Json | undefined)?.cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) options.onCost?.(cost);
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

export const callIntakeModel: IntakeClient = (setting, prompt, options = {}) => callStructuredModel(setting, prompt, INTAKE_SPEC, options);

/** Asks the model for JSON matching `spec.schema`, returning the raw text or object it produced. */
export async function callStructuredModel(setting: IntakeModelSetting, prompt: ModelPrompt, spec: StructuredSpec, options: IntakeCallOptions = {}): Promise<unknown> {
  const user = prompt.context ? `${prompt.context}\n\n${prompt.user}` : prompt.user;
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: user },
  ];
  const { schema, maxTokens, temperature } = spec;
  const toolName = spec.toolName ?? spec.name;
  const responseFormat = { type: "json_schema", json_schema: { name: spec.name, strict: true, schema } };

  switch (setting.provider) {
    case "openrouter": {
      const url = `${setting.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`;
      const headers = { authorization: `Bearer ${setting.apiKey}`, "x-title": BRAND_NAME };
      const body: Json = {
        model: setting.model,
        messages: prompt.context ? [messages[0], { role: "user", content: prompt.context }, { role: "user", content: prompt.user }] : messages,
        response_format: responseFormat,
        provider: { require_parameters: true },
        temperature,
        max_tokens: maxTokens,
      };
      if (setting.fallbackModels?.length) body.models = [setting.model, ...setting.fallbackModels];
      if (spec.webResults) body.plugins = [{ id: "web", engine: "exa", max_results: spec.webResults }];
      const effort = setting.reasoning ?? "none";
      const send = (reasoning?: ReasoningEffort) =>
        postJson(url, headers, reasoning ? { ...body, reasoning: { effort: reasoning } } : body, options);
      // Reasoning models such as DeepSeek V4 Flash think by default and can spend the whole output budget
      // before answering, so a model picked by override starts with reasoning switched off. Models without
      // the switch have no host that accepts it under require_parameters (404); models that always reason
      // refuse to turn it off (400).
      const data = await send(effort).catch((error: unknown) => {
        if (!(error instanceof RequestFailed) || effort !== "none") throw error;
        if (error.status === 404) return send();
        if (error.needsReasoning) return send("low");
        throw error;
      });
      reportCost(data, options);
      return (asArray(data.choices)[0]?.message as Json | undefined)?.content;
    }
    case "openai": {
      const data = await postJson(
        "https://api.openai.com/v1/chat/completions",
        { authorization: `Bearer ${setting.apiKey}` },
        { model: setting.model, messages, response_format: responseFormat, temperature, max_completion_tokens: maxTokens },
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
          max_tokens: maxTokens,
          temperature,
          system: prompt.system,
          messages: [{ role: "user", content: user }],
          tools: [{ name: toolName, description: "Record the structured result.", input_schema: schema }],
          tool_choice: { type: "tool", name: toolName },
        },
        options,
      );
      return asArray(data.content).find((block) => block.type === "tool_use" && block.name === toolName)?.input;
    }
    case "gemini": {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setting.model)}:generateContent`,
        { "x-goog-api-key": setting.apiKey },
        {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(schema),
            temperature,
            maxOutputTokens: maxTokens,
          },
        },
        options,
      );
      const parts = asArray((asArray(data.candidates)[0]?.content as Json | undefined)?.parts);
      return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
    }
  }
}
