import { OPENROUTER_BASE_URL, type LiveSetting } from "@/lib/providers/config";
import { MODEL_LABELS, type ModelId } from "@/lib/sov/types";

export interface LiveResult {
  text: string;
  citations: string[];
}

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1200;

async function postJson(
  model: ModelId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(" ");
    throw new Error(`${MODEL_LABELS[model]} request failed (${status})`);
  }
  return response.json();
}

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

async function askOpenAI(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal): Promise<LiveResult> {
  const body: Json = { model: s.modelName, messages: [{ role: "user", content: question }] };
  if (s.webSearch) body.web_search_options = {};
  const data = (await postJson(
    "chatgpt",
    "https://api.openai.com/v1/chat/completions",
    { authorization: `Bearer ${s.apiKey}` },
    body,
    f,
    signal,
  )) as Json;
  const message = (asArray(data.choices)[0]?.message ?? {}) as Json;
  const citations = asArray(message.annotations)
    .filter((a) => a.type === "url_citation")
    .map((a) => asString((a.url_citation as Json | undefined)?.url))
    .filter(Boolean);
  return { text: asString(message.content), citations };
}

async function askAnthropic(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal): Promise<LiveResult> {
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

async function askGemini(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal): Promise<LiveResult> {
  const body: Json = { contents: [{ role: "user", parts: [{ text: question }] }] };
  if (s.webSearch) body.tools = [{ google_search: {} }];
  const data = (await postJson(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.modelName)}:generateContent`,
    { "x-goog-api-key": s.apiKey },
    body,
    f,
    signal,
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

async function askPerplexity(question: string, s: LiveSetting, f: typeof fetch, signal?: AbortSignal): Promise<LiveResult> {
  const data = (await postJson(
    "perplexity",
    "https://api.perplexity.ai/chat/completions",
    { authorization: `Bearer ${s.apiKey}` },
    { model: s.modelName, messages: [{ role: "user", content: question }] },
    f,
    signal,
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
): Promise<LiveResult> {
  const body: Json = { model: s.modelName, messages: [{ role: "user", content: question }] };
  if (s.webSearch && model !== "perplexity") body.plugins = [{ id: "web" }];
  const data = (await postJson(
    model,
    `${s.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`,
    { authorization: `Bearer ${s.apiKey}`, "x-title": "Meadowlark" },
    body,
    f,
    signal,
  )) as Json;
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
  return { text: asString(message.content), citations };
}

export async function askLive(
  model: ModelId,
  question: string,
  setting: LiveSetting,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LiveResult> {
  if (setting.via === "openrouter") return askOpenRouter(model, question, setting, fetchImpl, signal);
  switch (model) {
    case "chatgpt":
      return askOpenAI(question, setting, fetchImpl, signal);
    case "claude":
      return askAnthropic(question, setting, fetchImpl, signal);
    case "gemini":
      return askGemini(question, setting, fetchImpl, signal);
    case "perplexity":
      return askPerplexity(question, setting, fetchImpl, signal);
  }
}
