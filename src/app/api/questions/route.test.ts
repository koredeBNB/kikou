import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/questions/route";

const brief = { product: "Trust Wallet", category: "crypto wallet", audience: "", competitors: [], website: "trustwallet.com" };
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/questions", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }));

function writerReplies() {
  let call = 0;
  return vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const count = JSON.parse(body.messages[1].content).count as number;
    call++;
    const questions = Array.from({ length: count }, (_, i) => `Which crypto wallet suits situation number ${call * 100 + i} for a careful saver?`);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status: 200 });
  });
}

beforeEach(() => {
  vi.stubEnv("SOV_FORCE_MOCK", "");
  vi.stubEnv("SOV_INTAKE_RULES", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/questions", () => {
  it("writes the extra questions with the model", async () => {
    const fetchMock = writerReplies();
    vi.stubGlobal("fetch", fetchMock);
    const response = await post({ brief, count: 30 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const plan = await response.json();
    expect(plan.source).toBe("ai");
    expect(plan.requested).toBe(30);
    expect(plan.questions).toHaveLength(30);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses templates when no model is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const plan = await (await post({ brief, count: 15 })).json();
    expect(plan.source).toBe("templates");
    expect(plan.questions).toHaveLength(15);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses templates when the model fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const plan = await (await post({ brief, count: 12 })).json();
    expect(plan.source).toBe("templates");
    expect(plan.questions).toHaveLength(12);
  });

  it("rejects a bad request", async () => {
    expect((await post({ brief, count: 500 })).status).toBe(400);
    expect((await post({ count: 10 })).status).toBe(400);
  });
});
