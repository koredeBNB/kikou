import { describe, expect, it } from "vitest";
import { providerStatus, resolveProviders } from "@/lib/providers/config";
import { askLive } from "@/lib/providers/live";

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

describe("resolveProviders", () => {
  it("uses mock mode for every model when no keys are set", () => {
    const providers = resolveProviders({});
    expect(Object.values(providers).every((p) => !p.live)).toBe(true);
  });

  it("switches a model to live when its key is present, with overridable model names", () => {
    const providers = resolveProviders({
      OPENAI_API_KEY: "sk-test",
      ANTHROPIC_API_KEY: "ak-test",
      ANTHROPIC_MODEL: "claude-custom",
      GOOGLE_API_KEY: "g-test",
      PERPLEXITY_API_KEY: "p-test",
    });
    expect(providers.chatgpt).toMatchObject({ live: true, apiKey: "sk-test", modelName: "gpt-4.1-mini" });
    expect(providers.claude).toMatchObject({ live: true, modelName: "claude-custom" });
    expect(providers.gemini).toMatchObject({ live: true, apiKey: "g-test" });
    expect(providers.perplexity).toMatchObject({ live: true, modelName: "sonar" });
  });

  it("can be forced into mock mode", () => {
    const providers = resolveProviders({ OPENAI_API_KEY: "sk-test", SOV_FORCE_MOCK: "1" });
    expect(providers.chatgpt.live).toBe(false);
  });

  it("runs every assistant through OpenRouter when only an OpenRouter key is set", () => {
    const providers = resolveProviders({ OPENROUTER_API_KEY: "or-test" });
    expect(providers).toEqual({
      chatgpt: { live: true, via: "openrouter", apiKey: "or-test", modelName: "openai/gpt-6-luna", webSearch: true, baseUrl: "https://openrouter.ai/api/v1" },
      claude: { live: true, via: "openrouter", apiKey: "or-test", modelName: "anthropic/claude-haiku-5.5", webSearch: true, baseUrl: "https://openrouter.ai/api/v1" },
      gemini: { live: true, via: "openrouter", apiKey: "or-test", modelName: "google/gemini-3.1-flash-lite", webSearch: true, baseUrl: "https://openrouter.ai/api/v1" },
      perplexity: { live: true, via: "openrouter", apiKey: "or-test", modelName: "perplexity/sonar", webSearch: true, baseUrl: "https://openrouter.ai/api/v1" },
    });
  });

  it("lets each *_WEB_SEARCH flag turn OpenRouter web search off", () => {
    const providers = resolveProviders({
      OPENROUTER_API_KEY: "or-test",
      OPENAI_WEB_SEARCH: "false",
      ANTHROPIC_WEB_SEARCH: "off",
      GEMINI_WEB_SEARCH: "0",
    });
    expect(providers.chatgpt).toMatchObject({ via: "openrouter", webSearch: false });
    expect(providers.claude).toMatchObject({ via: "openrouter", webSearch: false });
    expect(providers.gemini).toMatchObject({ via: "openrouter", webSearch: false });
  });

  it("treats a blank *_WEB_SEARCH flag as unset", () => {
    const providers = resolveProviders({ OPENROUTER_API_KEY: "or-test", OPENAI_WEB_SEARCH: "", GEMINI_WEB_SEARCH: "  " });
    expect(providers.chatgpt).toMatchObject({ via: "openrouter", webSearch: true });
    expect(providers.gemini).toMatchObject({ via: "openrouter", webSearch: true });
  });

  it("keeps web search off by default for direct keys, which need their own setup", () => {
    const providers = resolveProviders({ OPENAI_API_KEY: "sk", ANTHROPIC_API_KEY: "ak", GEMINI_API_KEY: "g" });
    expect([providers.chatgpt, providers.claude, providers.gemini].map((p) => p.live && p.webSearch)).toEqual([false, false, false]);
  });

  it("prefers a direct key, and lets each OpenRouter model and web search be overridden", () => {
    const providers = resolveProviders({
      OPENROUTER_API_KEY: "or-test",
      OPENAI_API_KEY: "sk-test",
      OPENROUTER_CLAUDE_MODEL: "anthropic/claude-sonnet-5.5",
      GEMINI_WEB_SEARCH: "true",
    });
    expect(providers.chatgpt).toEqual({ live: true, apiKey: "sk-test", modelName: "gpt-4.1-mini", webSearch: false });
    expect(providers.claude).toMatchObject({ via: "openrouter", modelName: "anthropic/claude-sonnet-5.5" });
    expect(providers.gemini).toMatchObject({ via: "openrouter", webSearch: true });
  });

  it("keeps mock mode when forced, even with an OpenRouter key", () => {
    const providers = resolveProviders({ OPENROUTER_API_KEY: "or-test", SOV_FORCE_MOCK: "true" });
    expect(Object.values(providers).every((p) => !p.live)).toBe(true);
  });

  it("says when an assistant runs through OpenRouter", () => {
    const status = providerStatus({ OPENROUTER_API_KEY: "or-secret", PERPLEXITY_API_KEY: "p-test" });
    expect(status.find((s) => s.id === "claude")).toEqual({
      id: "claude",
      label: "Claude",
      source: "live",
      modelName: "anthropic/claude-haiku-5.5",
      via: "openrouter",
    });
    expect(status.find((s) => s.id === "perplexity")).toEqual({ id: "perplexity", label: "Perplexity", source: "live", modelName: "sonar" });
    expect(JSON.stringify(status)).not.toContain("or-secret");
  });

  it("reports status without exposing keys", () => {
    const status = providerStatus({ OPENAI_API_KEY: "sk-secret" });
    expect(status.find((s) => s.id === "chatgpt")).toEqual({
      id: "chatgpt",
      label: "ChatGPT",
      source: "live",
      modelName: "gpt-4.1-mini",
    });
    expect(status.find((s) => s.id === "claude")?.source).toBe("mock");
    expect(JSON.stringify(status)).not.toContain("sk-secret");
  });
});

describe("askLive", () => {
  it("calls OpenAI chat completions and reads URL annotations", async () => {
    const { impl, calls } = fakeFetch({
      choices: [
        {
          message: {
            content: "Try **Acme**.",
            annotations: [{ type: "url_citation", url_citation: { url: "https://g2.com/x" } }],
          },
        },
      ],
    });
    const result = await askLive(
      "chatgpt",
      "Best CRM?",
      { live: true, apiKey: "sk-test", modelName: "gpt-4.1-mini", webSearch: false },
      impl,
    );
    expect(result).toEqual({ text: "Try **Acme**.", citations: ["https://g2.com/x"] });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(headersOf(calls[0]).get("authorization")).toBe("Bearer sk-test");
    expect(bodyOf(calls[0])).toMatchObject({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "Best CRM?" }] });
  });

  it("calls Anthropic messages, joins text blocks and collects citations", async () => {
    const { impl, calls } = fakeFetch({
      content: [
        { type: "text", text: "Consider Acme", citations: [{ type: "web_search_result_location", url: "https://capterra.com/a" }] },
        { type: "server_tool_use", id: "x" },
        { type: "text", text: " and Close." },
      ],
    });
    const result = await askLive(
      "claude",
      "Best CRM?",
      { live: true, apiKey: "ak-test", modelName: "claude-haiku-4-5", webSearch: true },
      impl,
    );
    expect(result).toEqual({ text: "Consider Acme and Close.", citations: ["https://capterra.com/a"] });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(headersOf(calls[0]).get("x-api-key")).toBe("ak-test");
    expect(headersOf(calls[0]).get("anthropic-version")).toBe("2023-06-01");
    expect(bodyOf(calls[0]).tools[0]).toMatchObject({ type: "web_search_20250305", name: "web_search" });
  });

  it("calls Gemini generateContent and resolves grounding sources to real domains", async () => {
    const { impl, calls } = fakeFetch({
      candidates: [
        {
          content: { parts: [{ text: "Acme is " }, { text: "popular." }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "techradar.com" } },
              { web: { uri: "https://www.pcmag.com/picks/crm", title: "Best CRM" } },
            ],
          },
        },
      ],
    });
    const result = await askLive(
      "gemini",
      "Best CRM?",
      { live: true, apiKey: "g-test", modelName: "gemini-2.5-flash", webSearch: true },
      impl,
    );
    expect(result).toEqual({
      text: "Acme is popular.",
      citations: ["https://techradar.com", "https://www.pcmag.com/picks/crm"],
    });
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(headersOf(calls[0]).get("x-goog-api-key")).toBe("g-test");
    expect(bodyOf(calls[0]).tools).toEqual([{ google_search: {} }]);
  });

  it("calls Perplexity and reads its citations list", async () => {
    const { impl, calls } = fakeFetch({
      choices: [{ message: { content: "Acme [1]" } }],
      citations: ["https://reddit.com/r/crm"],
    });
    const result = await askLive(
      "perplexity",
      "Best CRM?",
      { live: true, apiKey: "p-test", modelName: "sonar", webSearch: true },
      impl,
    );
    expect(result).toEqual({ text: "Acme [1]", citations: ["https://reddit.com/r/crm"] });
    expect(calls[0].url).toBe("https://api.perplexity.ai/chat/completions");
  });

  it("falls back to Perplexity search_results when citations are absent", async () => {
    const { impl } = fakeFetch({
      choices: [{ message: { content: "Acme" } }],
      search_results: [{ url: "https://g2.com/y" }],
    });
    const result = await askLive("perplexity", "q", { live: true, apiKey: "p", modelName: "sonar", webSearch: true }, impl);
    expect(result.citations).toEqual(["https://g2.com/y"]);
  });

  const viaOpenRouter = (modelName: string, webSearch = false) =>
    ({ live: true, via: "openrouter", apiKey: "or-test", modelName, webSearch, baseUrl: "https://openrouter.ai/api/v1" }) as const;

  it("calls OpenRouter's chat completions and reads URL annotations", async () => {
    const { impl, calls } = fakeFetch({
      choices: [
        {
          message: {
            content: "Try **Acme**.",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://g2.com/x", title: "G2" } },
              { type: "url_citation", url_citation: { url: "https://g2.com/x", title: "G2" } },
              { type: "url_citation", url_citation: { url: "https://capterra.com/y" } },
            ],
          },
        },
      ],
    });
    const result = await askLive("chatgpt", "Best CRM?", viaOpenRouter("openai/gpt-6-luna"), impl);
    expect(result).toEqual({ text: "Try **Acme**.", citations: ["https://g2.com/x", "https://capterra.com/y"] });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headersOf(calls[0]).get("authorization")).toBe("Bearer or-test");
    expect(headersOf(calls[0]).get("x-title")).toBe("Kioku");
    expect(bodyOf(calls[0])).toEqual({ model: "openai/gpt-6-luna", messages: [{ role: "user", content: "Best CRM?" }] });
  });

  it("turns on OpenRouter web search for assistants that need it", async () => {
    const { impl, calls } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
    await askLive("gemini", "q", viaOpenRouter("google/gemini-3.1-flash-lite", true), impl);
    expect(bodyOf(calls[0]).plugins).toEqual([{ id: "web" }]);
  });

  it("reads each assistant's web search sources through OpenRouter", async () => {
    // Shapes from live OpenRouter web plugin responses.
    const cite = (url: string, title: string) => ({ type: "url_citation", url_citation: { url, title, start_index: 0, end_index: 10 } });
    const openai = fakeFetch({
      choices: [{ message: { content: "Plausible", annotations: [cite("https://plausible.io/docs?utm_source=openai", "Plausible docs")] } }],
    });
    expect((await askLive("chatgpt", "q", viaOpenRouter("openai/gpt-6-luna", true), openai.impl)).citations).toEqual([
      "https://plausible.io/docs?utm_source=openai",
    ]);

    const claude = fakeFetch({
      choices: [{ message: { content: "Plausible", annotations: [cite("https://seline.com/blog/web-analytics-tools", "6 Best Website Analytics Tools")] } }],
    });
    expect((await askLive("claude", "q", viaOpenRouter("anthropic/claude-haiku-5.5", true), claude.impl)).citations).toEqual([
      "https://seline.com/blog/web-analytics-tools",
    ]);

    const gemini = fakeFetch({
      choices: [
        {
          message: {
            content: "Plausible",
            annotations: [
              cite("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEFR5", "plausible.io"),
              cite("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG3eP", "quantummetric.com"),
              cite("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH3Of", "Best tools for 2026"),
            ],
          },
        },
      ],
    });
    expect((await askLive("gemini", "q", viaOpenRouter("google/gemini-3.1-flash-lite", true), gemini.impl)).citations).toEqual([
      "https://plausible.io",
      "https://quantummetric.com",
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH3Of",
    ]);
  });

  it("keeps Perplexity's own citation order through OpenRouter", async () => {
    const { impl, calls } = fakeFetch({
      choices: [
        {
          message: {
            content: "Acme [1] and Close [2]",
            annotations: [{ type: "url_citation", url_citation: { url: "https://b.com/2" } }],
          },
        },
      ],
      citations: ["https://a.com/1", "https://b.com/2"],
    });
    const result = await askLive("perplexity", "q", viaOpenRouter("perplexity/sonar", true), impl);
    expect(result.citations).toEqual(["https://a.com/1", "https://b.com/2"]);
    expect(bodyOf(calls[0]).plugins).toBeUndefined();

    const annotated = fakeFetch({
      choices: [{ message: { content: "Acme [1]", annotations: [{ type: "url_citation", url_citation: { url: "https://a.com/1" } }] } }],
    });
    expect((await askLive("perplexity", "q", viaOpenRouter("perplexity/sonar", true), annotated.impl)).citations).toEqual([
      "https://a.com/1",
    ]);
  });

  it("names the assistant, not the key, when OpenRouter fails", async () => {
    const { impl } = fakeFetch({ error: { message: "Insufficient credits for or-test" } }, 402);
    const call = () => askLive("claude", "q", viaOpenRouter("anthropic/claude-haiku-5.5"), impl);
    await expect(call()).rejects.toThrow(/Claude request failed \(402\)/);
    await expect(call()).rejects.not.toThrow(/or-test/);
  });

  it("throws a readable error with the status code and no secrets", async () => {
    const { impl } = fakeFetch({ error: { message: "Incorrect API key sk-test provided" } }, 401);
    await expect(
      askLive("chatgpt", "q", { live: true, apiKey: "sk-test", modelName: "m", webSearch: false }, impl),
    ).rejects.toThrow(/ChatGPT request failed \(401\)/);
    await expect(
      askLive("chatgpt", "q", { live: true, apiKey: "sk-test", modelName: "m", webSearch: false }, impl),
    ).rejects.not.toThrow(/sk-test/);
  });
});
