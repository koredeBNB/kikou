import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/brands/route";

let visitor = 0;
const post = (payload: unknown, ip = `198.51.100.${++visitor}`) =>
  POST(
    new Request("http://localhost/api/brands", {
      method: "POST",
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-real-ip": ip },
    }),
  );

const body = {
  product: "MetaMask",
  category: "crypto wallet",
  competitors: ["Phantom"],
  candidates: [
    { name: "Solana", context: "**Solana:** Phantom is the usual choice." },
    { name: "Ledger Nano X", context: "**Ledger Nano X** – Bluetooth." },
    { name: "Ledger", context: "**Ledger** – hardware." },
  ],
};
const verdict = { notRivals: ["Solana"], productLines: [{ name: "Ledger Nano X", brand: "Ledger" }] };

function modelReplies(content: unknown) {
  return vi.fn(async (_url: string | URL, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.0003 } }), { status: 200 });
  });
}

beforeEach(() => {
  vi.stubEnv("SOV_FORCE_MOCK", "");
  vi.stubEnv("SOV_INTAKE_RULES", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/brands", () => {
  it("returns the model's review of the names", async () => {
    const fetchMock = modelReplies(verdict);
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ source: "ai", output: verdict });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.response_format.json_schema.name).toBe("brand_review");
    expect(JSON.parse(sent.messages.at(-1).content).names).toHaveLength(3);
  });

  it("leaves the rules' brands standing when the model is off or its answer is unusable", async () => {
    vi.stubGlobal("fetch", modelReplies({ notRivals: "Solana" }));
    expect(await (await post(body)).json()).toEqual({ source: "rules", reason: "invalid" });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await (await post(body)).json()).toEqual({ source: "rules", reason: "no-model" });
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    vi.stubEnv("SOV_INTAKE_RULES", "1");
    expect(await (await post(body)).json()).toEqual({ source: "rules", reason: "forced" });
  });

  it.each([
    ["no names", { ...body, candidates: [] }],
    ["a missing category", { ...body, category: " " }],
    ["a body that isn't JSON", "Solana"],
  ])("rejects %s", async (_label, payload) => {
    expect((await post(payload)).status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    expect((await post({ ...body, padding: "x".repeat(20_000) })).status).toBe(413);
  });

  it("shares the intake limit of 150 calls an hour per visitor", async () => {
    vi.stubGlobal("fetch", modelReplies(verdict));
    const ip = "203.0.113.77";
    for (let i = 0; i < 150; i++) expect((await post(body, ip)).status).toBe(200);
    const refused = await post(body, ip);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
  });
});
