import { describe, expect, it } from "vitest";
import { identifyBrand, lookupSetting, lookUpBrand, reviseBrief } from "@/lib/intake/identify";

const env = { OPENROUTER_API_KEY: "or-test" };
const input = { reply: "bnb chain, rwa and ai", earlier: [] };
const output = {
  recognized: "yes",
  name: "BNB Chain",
  description: "the Layer 1 blockchain behind the BNB token",
  category: "layer 1 blockchain",
  website: "bnbchain.org",
  audience: "web3 developers",
  competitors: ["Ethereum", "Solana"],
  topics: ["RWA", "AI"],
  alternatives: [],
  count: null,
  message: "Do you mean **BNB Chain**?",
};

function replying(content: unknown, cost?: number) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const usage = cost === undefined ? {} : { usage: { cost } };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], ...usage }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

describe("lookupSetting", () => {
  it("looks brands up through OpenRouter unless SOV_INTAKE_WEB_LOOKUP turns it off", () => {
    expect(lookupSetting(env)?.provider).toBe("openrouter");
    expect(lookupSetting({ ...env, SOV_INTAKE_WEB_LOOKUP: "true" })).not.toBeNull();
    expect(lookupSetting({ ...env, SOV_INTAKE_WEB_LOOKUP: "off" })).toBeNull();
    expect(lookupSetting({ OPENAI_API_KEY: "sk" })).toBeNull();
    expect(lookupSetting({})).toBeNull();
  });
});

describe("identifyBrand", () => {
  it("returns the decoded output and what it cost", async () => {
    const { fetchImpl, bodies } = replying(output, 0.0006);
    expect(await identifyBrand(input, { env, fetchImpl })).toEqual({ ok: true, output, costUsd: 0.0006 });
    expect(bodies[0]).toMatchObject({ response_format: { json_schema: { name: "brand_brief" } }, temperature: 0 });
    expect(bodies[0].plugins).toBeUndefined();
  });

  it("reports output that doesn't pass the checks as invalid, still with its cost", async () => {
    const { fetchImpl } = replying({ ...output, recognized: "maybe" }, 0.0005);
    expect(await identifyBrand(input, { env, fetchImpl })).toEqual({ ok: false, reason: "invalid", costUsd: 0.0005 });
  });

  it("says why there's no answer when there's no model, the rules are forced, or the call fails", async () => {
    expect(await identifyBrand(input, { env: {} })).toEqual({ ok: false, reason: "no-model" });
    expect(await identifyBrand(input, { env: { ...env, SOV_INTAKE_RULES: "1" } })).toEqual({ ok: false, reason: "forced" });
    const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await identifyBrand(input, { env, fetchImpl: failing })).toEqual({ ok: false, reason: "error" });
  });

  it("gives up on a slow model", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    expect(await identifyBrand(input, { env, fetchImpl: hang, timeoutMs: 20 })).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("lookUpBrand", () => {
  it("asks for three web results and checks the name against the user's words", async () => {
    const { fetchImpl, bodies } = replying({ ...output, name: "Attio", category: "crm", website: "attio.com" }, 0.008);
    expect(await lookUpBrand({ reply: "Attio", earlier: [] }, { env, fetchImpl })).toMatchObject({ ok: true, costUsd: 0.008 });
    expect(bodies[0].plugins).toEqual([{ id: "web", engine: "exa", max_results: 3 }]);
    const renamed = replying({ ...output, name: "Attica" }, 0.008);
    expect(await lookUpBrand({ reply: "Attio", earlier: [] }, { env, fetchImpl: renamed.fetchImpl })).toEqual({ ok: false, reason: "invalid", costUsd: 0.008 });
  });

  it("can't run without OpenRouter", async () => {
    expect(await lookUpBrand({ reply: "Attio", earlier: [] }, { env: { OPENAI_API_KEY: "sk" } })).toEqual({ ok: false, reason: "no-model" });
  });
});

describe("reviseBrief", () => {
  it("sends the brief and stage, and validates the revision", async () => {
    const brief = { product: "BNB Chain", category: "layer 1 blockchain", audience: "", competitors: ["Ethereum"] };
    const change = {
      intent: "change",
      proceed: false,
      brief: { ...brief, description: null, audience: null, website: null, competitors: ["Ethereum", "Base"], topics: [] },
      question: null,
      count: null,
      message: "Done: I added Base.",
    };
    const { fetchImpl, bodies } = replying(change);
    expect(await reviseBrief({ reply: "add Base", brief, stage: "plan" }, { env, fetchImpl })).toMatchObject({ ok: true, output: change });
    const messages = bodies[0].messages as { content: string }[];
    expect(JSON.parse(messages[1].content)).toMatchObject({ stage: "plan", reply: "add Base", brief: { product: "BNB Chain" } });
  });
});
