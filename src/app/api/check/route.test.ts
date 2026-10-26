import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/check/route";
import { dailyChecks } from "@/lib/sov/limit";

const body = {
  brief: { product: "Acme", category: "CRM", audience: "small agencies", competitors: [] },
  questions: [{ id: "q1", text: "What's the best CRM for small agencies?", intent: "best-for" }],
  models: ["claude"],
};
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/check", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  Object.assign(dailyChecks(), { day: "", count: 0 });
  vi.stubEnv("SOV_FORCE_MOCK", "true");
  vi.stubEnv("SOV_MAX_CHECKS_PER_DAY", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/check daily cap", () => {
  it("refuses checks past the daily cap with a 429 and a friendly message", async () => {
    const first = await post(body);
    expect(first.status).toBe(200);
    await first.body?.cancel();

    const second = await post(body);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    const json = await second.json();
    expect(json.code).toBe("daily-limit");
    expect(json.error).toMatch(/^We've used today's one Kioku check/);
  });

  it("doesn't count requests that fail validation", async () => {
    expect((await post({ brief: {} })).status).toBe(400);
    const valid = await post(body);
    expect(valid.status).toBe(200);
    await valid.body?.cancel();
  });
});
