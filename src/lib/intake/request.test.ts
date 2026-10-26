import { describe, expect, it } from "vitest";
import { emptyIntake } from "@/lib/intake/flow";
import { requestIntake, validateIntakeRequest } from "@/lib/intake/request";

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
          skipped: ["audience"],
          nudged: [],
        },
      },
    });
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
