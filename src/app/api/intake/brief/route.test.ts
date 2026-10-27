import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/intake/brief/route";
import { safeFetch } from "@/lib/audit/safe-fetch";
import { utcDay } from "@/lib/sov/budget";
import { checkStore } from "@/lib/store";

vi.mock("@/lib/audit/safe-fetch", async (importOriginal) => ({ ...(await importOriginal<object>()), safeFetch: vi.fn() }));

let visitor = 0;
const post = (payload: unknown, ip = `198.51.100.${++visitor}`) =>
  POST(
    new Request("http://localhost/api/intake/brief", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-real-ip": ip },
    }),
  );

const brand = {
  recognized: "yes",
  name: "Attio",
  description: "a CRM for modern teams",
  category: "crm",
  websites: ["attio.com"],
  audience: "startups",
  competitors: ["HubSpot", "Salesforce"],
  topics: [],
  alternatives: [],
  count: null,
  message: "I looked it up. Is it **Attio**?",
};

function modelReplies(content: unknown, cost = 0.008) {
  return vi.fn(async (_url: string | URL, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost } }), { status: 200 });
  });
}

const spentToday = async () => (await checkStore().ledger(utcDay(new Date()), Date.now())).spentUsd;

beforeEach(() => {
  vi.stubEnv("SOV_FORCE_MOCK", "");
  vi.stubEnv("SOV_INTAKE_RULES", "");
  vi.stubEnv("SOV_INTAKE_WEB_LOOKUP", "");
  vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
});

afterEach(() => {
  vi.mocked(safeFetch).mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/intake/brief", () => {
  it("identifies a brand and says whether a web lookup is available", async () => {
    vi.stubGlobal("fetch", modelReplies({ ...brand, message: "Do you mean **Attio**?" }));
    const response = await post({ mode: "identify", reply: "Attio", earlier: [] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ source: "ai", output: { name: "Attio" }, lookup: true });

    vi.stubEnv("SOV_INTAKE_WEB_LOOKUP", "off");
    expect(await (await post({ mode: "identify", reply: "Attio", earlier: [] })).json()).toMatchObject({ source: "ai", lookup: false });
  });

  it("looks a brand up on the web and books what it cost to today's budget", async () => {
    const fetchMock = modelReplies(brand, 0.008);
    vi.stubGlobal("fetch", fetchMock);
    const before = await spentToday();
    expect(await (await post({ mode: "lookup", reply: "Attio", earlier: [] })).json()).toMatchObject({ source: "ai", output: { name: "Attio" } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).plugins).toEqual([{ id: "web", engine: "exa", max_results: 8 }]);
    expect((await spentToday()) - before).toBeCloseTo(0.008, 6);
  });

  it("reads the brand's own site before searching, and says which sites it read", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url) => {
      const page = (status: number, body: string, contentType: string) => ({ ok: true as const, page: { url, status, headers: {}, contentType, body, redirects: [], truncated: false } });
      return url.endsWith("/robots.txt") ? page(404, "", "text/html") : page(200, "<html><head><title>fomo | Social Crypto Trading App</title></head><body><h1>trade memecoins</h1></body></html>", "text/html");
    });
    const fetchMock = modelReplies({ ...brand, name: "fomo", description: "the social crypto trading app", category: "crypto trading app", websites: ["fomo.family"] });
    vi.stubGlobal("fetch", fetchMock);
    const response = await post({ mode: "lookup", reply: "https://fomo.family/?r=x", earlier: [], name: "fomo", sites: ["fomo.family"] });
    expect(await response.json()).toMatchObject({ source: "ai", output: { name: "fomo" }, read: ["fomo.family"] });
    expect(vi.mocked(safeFetch).mock.calls.map(([url]) => url)).toEqual(["https://fomo.family/robots.txt", "https://fomo.family/"]);
    const messages = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages as { content: string }[];
    expect(JSON.parse(messages[1].content).homepages[0]).toMatchObject({ site: "fomo.family", title: "fomo | Social Crypto Trading App" });
  });

  it("still books the cost of a lookup whose answer was unusable", async () => {
    vi.stubGlobal("fetch", modelReplies({ ...brand, name: "Attica" }, 0.009));
    const before = await spentToday();
    expect(await (await post({ mode: "lookup", reply: "Attio", earlier: [] })).json()).toEqual({ source: "rules", reason: "invalid" });
    expect((await spentToday()) - before).toBeCloseTo(0.009, 6);
  });

  it("skips lookups when the day's budget is nearly spent or there's nowhere safe to book them", async () => {
    const fetchMock = modelReplies(brand);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "0.01");
    expect(await (await post({ mode: "lookup", reply: "Attio", earlier: [] })).json()).toEqual({ source: "rules", reason: "no-model" });
    expect(await (await post({ mode: "identify", reply: "Attio", earlier: [] })).json()).toMatchObject({ lookup: false });

    vi.stubEnv("SOV_MAX_SPEND_PER_DAY", "");
    vi.stubEnv("VERCEL", "1");
    expect(await (await post({ mode: "lookup", reply: "Attio", earlier: [] })).json()).toEqual({ source: "rules", reason: "no-model" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("limits each visitor to 20 lookups an hour", async () => {
    vi.stubGlobal("fetch", modelReplies(brand, 0));
    const ip = "203.0.113.50";
    for (let i = 0; i < 20; i++) expect((await post({ mode: "lookup", reply: "Attio", earlier: [] }, ip)).status).toBe(200);
    const refused = await post({ mode: "lookup", reply: "Attio", earlier: [] }, ip);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await post({ mode: "identify", reply: "Attio", earlier: [] }, ip)).status).toBe(200);
  });

  it("reads a reply about the brief", async () => {
    const brief = { product: "Attio", category: "crm", audience: "", competitors: ["HubSpot"] };
    const change = {
      intent: "change",
      proceed: false,
      brief: { ...brief, description: null, audience: null, websites: [], competitors: ["HubSpot", "Pipedrive"], topics: [] },
      question: null,
      count: null,
      message: "Done: I added Pipedrive.",
    };
    vi.stubGlobal("fetch", modelReplies(change));
    expect(await (await post({ mode: "revise", reply: "add Pipedrive", brief, stage: "confirm" })).json()).toEqual({ source: "ai", output: change });
  });

  it("falls back to the rules without a model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await (await post({ mode: "identify", reply: "Attio", earlier: [] })).json()).toEqual({ source: "rules", reason: "no-model" });
  });

  it.each([
    ["an unknown mode", { mode: "guess", reply: "Attio" }],
    ["an empty reply", { mode: "identify", reply: " " }],
    ["a revision without a brief", { mode: "revise", reply: "add Base" }],
  ])("rejects %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
  });
});
