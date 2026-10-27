import { describe, expect, it } from "vitest";
import { emptyIntake } from "@/lib/intake/flow";
import { requestIdentify, requestIntake, requestLookup, requestRevision, validateBriefRequest, validateIntakeRequest } from "@/lib/intake/request";

describe("validateIntakeRequest", () => {
  it("accepts a reply for a known field and normalises the state", () => {
    const parsed = validateIntakeRequest({
      field: "competitors",
      reply: "  Planta, Greg  ",
      state: { product: "Fernly", category: "plant care app", competitors: ["Planta", 3], skipped: ["audience", "pricing"], nudged: "x" },
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        field: "competitors",
        reply: "Planta, Greg",
        state: {
          product: "Fernly",
          category: "plant care app",
          audience: "",
          competitors: ["Planta"],
          website: undefined,
          topics: [],
          count: undefined,
          skipped: ["audience"],
          nudged: [],
        },
      },
    });
  });

  it("keeps up to five short topics and a whole-number count from 1 to 100", () => {
    const parsed = validateIntakeRequest({
      field: "count",
      reply: "50",
      state: { product: "Fernly", topics: ["watering", 3, "x".repeat(200), "a", "b", "c", "d"], count: 25, skipped: ["topics", "count"] },
    });
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.state.topics).toEqual(["watering", "x".repeat(40), "a", "b", "c"]);
    expect(parsed.value.state.count).toBe(25);
    expect(parsed.value.state.skipped).toEqual(["topics", "count"]);
    for (const count of [0, 101, 2.5, "10"]) {
      const bad = validateIntakeRequest({ field: "count", reply: "x", state: { count } });
      expect(bad.ok && bad.value.state.count).toBeUndefined();
    }
  });

  it("keeps the brand's other sites as clean domains, and leaves them off when there are none", () => {
    const parsed = validateIntakeRequest({
      field: "website",
      reply: "also fernly.dev",
      state: { product: "Fernly", website: "fernly.app", otherSites: ["https://www.fernly.dev/docs", "blog.fernly.dev", "nope", 4], skipped: [] },
    });
    expect(parsed.ok && parsed.value.state.otherSites).toEqual(["fernly.dev"]);
    const none = validateIntakeRequest({ field: "website", reply: "x", state: { product: "Fernly", otherSites: [] } });
    expect(none.ok && "otherSites" in none.value.state).toBe(false);
  });

  it.each([
    ["no body", null],
    ["an unknown field", { field: "pricing", reply: "x", state: {} }],
    ["an empty reply", { field: "product", reply: "   ", state: {} }],
    ["a non-string reply", { field: "product", reply: 5, state: {} }],
  ])("rejects %s", (_label, body) => {
    expect(validateIntakeRequest(body).ok).toBe(false);
  });

  it("caps long replies and values", () => {
    const parsed = validateIntakeRequest({
      field: "product",
      reply: "y".repeat(5000),
      state: { product: "p".repeat(500), competitors: Array.from({ length: 20 }, (_, i) => `B${i}`) },
    });
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.reply.length).toBe(1000);
    expect(parsed.value.state.product.length).toBe(120);
    expect(parsed.value.state.competitors).toHaveLength(8);
  });
});

describe("requestIntake", () => {
  const input = { field: "product" as const, reply: "It's Fernly, a plant care app, site's fernly.app", state: emptyIntake() };
  const respond = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

  it("returns a validated AI turn from the server", async () => {
    const result = await requestIntake(input, {
      fetchImpl: respond({
        source: "ai",
        turn: { intent: "answer", values: { product: "Fernly", category: "plant care app", website: "fernly.app" }, asks: "audience", message: "Hi!" },
      }),
    });
    expect(result).toEqual({
      source: "ai",
      turn: { intent: "answer", values: { product: "Fernly", category: "plant care app", website: "fernly.app" }, asks: "audience", message: "Hi!" },
    });
  });

  it("re-reads rule-based results locally", async () => {
    const result = await requestIntake(
      { ...input, reply: "Acme, a CRM for small agencies" },
      { fetchImpl: respond({ source: "rules", reason: "no-model", turn: { intent: "skip", values: {} } }) },
    );
    expect(result).toEqual({
      source: "rules",
      reason: "no-model",
      turn: { intent: "answer", values: { product: "Acme", category: "CRM", audience: "small agencies" } },
    });
  });

  it("falls back to the rules when the server fails or sends junk", async () => {
    const failing = [
      respond({ error: "boom" }, 500),
      respond({ source: "ai", turn: { intent: "answer", values: { product: "Zapster" }, asks: "category", message: "" } }),
      (async () => {
        throw new TypeError("network down");
      }) as typeof fetch,
    ];
    for (const fetchImpl of failing) {
      const result = await requestIntake({ ...input, reply: "Acme, a CRM for small agencies" }, { fetchImpl });
      expect(result.source).toBe("rules");
      expect(result.turn.values).toEqual({ product: "Acme", category: "CRM", audience: "small agencies" });
    }
  });

  it("gives up on a slow server", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const result = await requestIntake({ ...input, reply: "Acme" }, { fetchImpl: hang, timeoutMs: 30 });
    expect(result).toMatchObject({ source: "rules", reason: "timeout", turn: { values: { product: "Acme" } } });
  });
});

describe("validateBriefRequest", () => {
  it("accepts identify and lookup requests, keeping the last two earlier replies", () => {
    expect(validateBriefRequest({ mode: "identify", reply: " Mercury ", earlier: ["a", 5, "b", "c"] })).toEqual({
      ok: true,
      value: { mode: "identify", reply: "Mercury", earlier: ["b", "c"] },
    });
    expect(validateBriefRequest({ mode: "lookup", reply: "Attio" })).toEqual({ ok: true, value: { mode: "lookup", reply: "Attio", earlier: [] } });
  });

  it("normalises the brief of a revision and defaults the stage to confirm", () => {
    const parsed = validateBriefRequest({
      mode: "revise",
      reply: "add Base",
      brief: { product: "BNB Chain", category: "layer 1 blockchain", description: "a chain", competitors: ["Ethereum", 7], topics: ["RWA", "x".repeat(90)], website: "" },
      stage: "launch",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        mode: "revise",
        reply: "add Base",
        stage: "confirm",
        brief: { product: "BNB Chain", category: "layer 1 blockchain", description: "a chain", audience: "", competitors: ["Ethereum"], topics: ["RWA", "x".repeat(40)] },
      },
    });
    expect(validateBriefRequest({ mode: "revise", reply: "x", brief: { product: "A", category: "crm", competitors: [] }, stage: "plan" })).toMatchObject({
      value: { stage: "plan" },
    });
    expect(
      validateBriefRequest({
        mode: "revise",
        reply: "also bnb.org",
        brief: { product: "BNB Chain", category: "blockchain", competitors: [], website: "bnbchain.org", otherSites: ["https://bnb.org/", "docs.bnbchain.org", 3] },
        stage: "sites",
      }),
    ).toMatchObject({ value: { stage: "sites", brief: { website: "bnbchain.org", otherSites: ["bnb.org"] } } });
  });

  it.each([
    ["no body", null],
    ["an unknown mode", { mode: "guess", reply: "x" }],
    ["an empty reply", { mode: "identify", reply: "" }],
    ["a revision without a category", { mode: "revise", reply: "x", brief: { product: "A" } }],
  ])("rejects %s", (_label, body) => {
    expect(validateBriefRequest(body).ok).toBe(false);
  });
});

describe("brief requests", () => {
  const respond = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
  const output = {
    recognized: "yes",
    name: "Attio",
    description: "a CRM for modern teams",
    category: "crm",
    websites: ["attio.com"],
    audience: "startups",
    competitors: ["HubSpot"],
    topics: [],
    alternatives: [],
    count: null,
    message: "Is it **Attio**?",
  };

  it("re-reads the model's output in the browser", async () => {
    const result = await requestIdentify({ reply: "Attio", earlier: [] }, { fetchImpl: respond({ source: "ai", output, lookup: true }) });
    expect(result).toEqual({
      identified: {
        kind: "draft",
        known: true,
        brief: { product: "Attio", description: "a CRM for modern teams", category: "crm", website: "attio.com", audience: "startups", competitors: ["HubSpot"] },
        message: "Is it **Attio**?",
      },
      lookup: true,
    });
    const lookedUp = await requestLookup({ reply: "Attica", earlier: [] }, { fetchImpl: respond({ source: "ai", output }) });
    expect(lookedUp).toBeNull();
  });

  it("returns nothing when the server falls back, fails or is slow, so the intake carries on", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    for (const fetchImpl of [respond({ source: "rules", reason: "no-model" }), respond({ error: "x" }, 500), hang]) {
      expect(await requestIdentify({ reply: "Attio", earlier: [] }, { fetchImpl, timeoutMs: 20 })).toEqual({ identified: null, lookup: false });
    }
    const brief = { product: "Attio", category: "crm", audience: "", competitors: [] };
    expect(await requestRevision({ reply: "add Base", brief, stage: "plan" }, { fetchImpl: hang, timeoutMs: 20 })).toBeNull();
  });
});
