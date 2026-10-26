import { BRAND_NAME } from "@/lib/brand";
import { OPENROUTER_BASE_URL, type LiveSetting } from "@/lib/providers/config";
import { MODEL_LABELS, type ModelId } from "@/lib/sov/types";

export interface LiveResult {
  text: string;
  citations: string[];
  costUsd?: number;
}

export const ANSWER_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1200;

export interface AskOptions {
  timeoutMs?: number;
}

/** A failed answer, with what a retry needs to know. Messages never include keys or response bodies. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** `retry-after` is either seconds or an HTTP date. */
function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

const failed = (model: ModelId, status: number, retryAfterMs?: number) =>
  new ProviderError(`${MODEL_LABELS[model]} request failed (${status})`, status, retryAfterMs);

async function postJson(
  model: ModelId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  timeoutMs = ANSWER_TIMEOUT_MS,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new ProviderError(`${MODEL_LABELS[model]} took too long to answer`, undefined, undefined, true);
    throw error;
  }
  if (!response.ok) throw failed(model, response.status, retryAfter(response.headers.get("retry-after")));
  return response.json();
}

/** OpenRouter can report an upstream failure inside a 200 response. */
function checkBody(model: ModelId, data: Json): Json {
  const error = data.error as Json | undefined;
  if (!error || (Array.isArray(data.choices) && data.choices.length)) return data;
  const code = Number(error.code);
  throw failed(model, Number.isInteger(code) && code >= 400 ? code : 502);
}

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

async function askOpenAI(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal, timeoutMs?: number): Promise<LiveResult> {
  const body: Json = { model: s.modelName, messages: [{ role: "user", content: question }] };
  if (s.webSearch) body.web_search_options = {};
  const data = (await postJson(
    "chatgpt",
    "https://api.openai.com/v1/chat/completions",
    { authorization: `Bearer ${s.apiKey}` },
    body,
    f,
    signal,
    timeoutMs,
  )) as Json;
  const message = (asArray(data.choices)[0]?.message ?? {}) as Json;
  const citations = asArray(message.annotations)
    .filter((a) => a.type === "url_citation")
    .map((a) => asString((a.url_citation as Json | undefined)?.url))
    .filter(Boolean);
  return { text: asString(message.content), citations };
}

async function askAnthropic(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal, timeoutMs?: number): Promise<LiveResult> {
  const body: Json = {
    model: s.modelName,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: question }],
  };
  if (s.webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  const data = (await postJson(
    "claude",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
    body,
    f,
    signal,
    timeoutMs,
  )) as Json;
  const blocks = asArray(data.content).filter((b) => b.type === "text");
  return {
    text: blocks.map((b) => asString(b.text)).join(""),
    citations: blocks.flatMap((b) => asArray(b.citations).map((c) => asString(c.url))).filter(Boolean),
  };
}

const DOMAIN_TITLE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Gemini grounding URIs are opaque Google redirects; the title usually carries the source domain. */
function groundedUrl(uri: string, title: string): string {
  const domain = title.trim();
  return uri.includes("vertexaisearch.cloud.google.com") && DOMAIN_TITLE.test(domain) ? `https://${domain}` : uri;
}

async function askGemini(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal, timeoutMs?: number): Promise<LiveResult> {
  const body: Json = { contents: [{ role: "user", parts: [{ text: question }] }] };
  if (s.webSearch) body.tools = [{ google_search: {} }];
  const data = (await postJson(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.modelName)}:generateContent`,
    { "x-goog-api-key": s.apiKey },
    body,
    f,
    signal,
    timeoutMs,
  )) as Json;
  const candidate = asArray(data.candidates)[0] ?? {};
  const parts = asArray((candidate.content as Json | undefined)?.parts);
  const chunks = asArray((candidate.groundingMetadata as Json | undefined)?.groundingChunks);
  const citations = chunks
    .map((chunk) => {
      const web = (chunk.web ?? {}) as Json;
      return groundedUrl(asString(web.uri), asString(web.title));
    })
    .filter(Boolean);
  return { text: parts.map((p) => asString(p.text)).join(""), citations };
}

async function askPerplexity(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal, timeoutMs?: number): Promise<LiveResult> {
  const data = (await postJson(
    "perplexity",
    "https://api.perplexity.ai/chat/completions",
    { authorization: `Bearer ${s.apiKey}` },
    { model: s.modelName, messages: [{ role: "user", content: question }] },
    f,
    signal,
    timeoutMs,
  )) as Json;
  const message = (asArray(data.choices)[0]?.message ?? {}) as Json;
  const listed = Array.isArray(data.citations) ? (data.citations as unknown[]).map(asString) : [];
  const fromResults = asArray(data.search_results).map((r) => asString(r.url));
  return { text: asString(message.content), citations: (listed.length ? listed : fromResults).filter(Boolean) };
}

const unique = (urls: string[]) => [...new Set(urls.filter(Boolean))];

/** OpenRouter's OpenAI-compatible API. Sources come back as url_citation annotations; Perplexity also lists `citations`. */
async function askOpenRouter(
  model: ModelId,
  question: string,
  s: LiveSetting,
  f: typeof fetch,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<LiveResult> {
  const body: Json = { model: s.modelName, messages: [{ role: "user", content: question }] };
  if (s.webSearch && model !== "perplexity") body.plugins = [{ id: "web" }];
  const data = checkBody(
    model,
    (await postJson(
      model,
      `${s.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`,
      { authorization: `Bearer ${s.apiKey}`, "x-title": BRAND_NAME },
      body,
      f,
      signal,
      timeoutMs,
    )) as Json,
  );
  const message = (asArray(data.choices)[0]?.message ?? {}) as Json;
  const listed = Array.isArray(data.citations) ? (data.citations as unknown[]).map(asString) : [];
  const annotated = asArray(message.annotations)
    .filter((a) => a.type === "url_citation")
    .map((a) => {
      const cite = (a.url_citation ?? {}) as Json;
      return groundedUrl(asString(cite.url), asString(cite.title));
    });
  const fromResults = asArray(data.search_results).map((r) => asString(r.url));
  const citations = [listed, annotated, fromResults].map(unique).find((urls) => urls.length) ?? [];
  const result: LiveResult = { text: asString(message.content), citations };
  const cost = ((data.usage ?? {}) as Json).cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) result.costUsd = cost;
  return result;
}

export async function askLive(
  model: ModelId,
  question: string,
  setting: LiveSetting,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  { timeoutMs }: AskOptions = {},
): Promise<LiveResult> {
  if (setting.via === "openrouter") return askOpenRouter(model, question, setting, fetchImpl, signal, timeoutMs);
  switch (model) {
    case "chatgpt":
      return askOpenAI(question, setting, fetchImpl, signal, timeoutMs);
    case "claude":
      return askAnthropic(question, setting, fetchImpl, signal, timeoutMs);
    case "gemini":
      return askGemini(question, setting, fetchImpl, signal, timeoutMs);
    case "perplexity":
      return askPerplexity(question, setting, fetchImpl, signal, timeoutMs);
  }
}
