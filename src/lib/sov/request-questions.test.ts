import { describe, expect, it } from "vitest";
import { requestQuestions } from "@/lib/sov/request-questions";

const brief = { product: "Trust Wallet", category: "crypto wallet", audience: "", competitors: [] };
const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("requestQuestions", () => {
  it("uses the server's plan, keeping only well-formed questions", async () => {
    const plan = await requestQuestions(brief, 10, {
      fetchImpl: respond({
        source: "ai",
        requested: 10,
        questions: [
          { id: "q1", text: "Which crypto wallet is safest?", intent: "features" },
          { id: "q2", text: "Best wallet for staking?", intent: "best-for", topic: "staking" },
          { id: "q3", text: "", intent: "budget" },
        ],
      }),
    });
    expect(plan.source).toBe("ai");
    expect(plan.questions).toEqual([
      { id: "q1", text: "Which crypto wallet is safest?", intent: "features" },
      { id: "q2", text: "Best wallet for staking?", intent: "best-for", topic: "staking" },
    ]);
  });

  it("plans locally from templates when the server fails or sends nothing usable", async () => {
    for (const fetchImpl of [respond({ error: "nope" }, 500), respond({ questions: [] })]) {
      const plan = await requestQuestions(brief, 10, { fetchImpl, year: 2026 });
      expect(plan.source).toBe("templates");
      expect(plan.questions).toHaveLength(10);
    }
  });

  it("plans locally when the server is too slow", async () => {
    const fetchImpl = ((_url: string | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const plan = await requestQuestions(brief, 8, { fetchImpl, timeoutMs: 20, year: 2026 });
    expect(plan.source).toBe("templates");
    expect(plan.questions).toHaveLength(8);
  });

  it("doesn't call the server for small broad checks", async () => {
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    const plan = await requestQuestions(brief, 5, { fetchImpl });
    expect(plan).toMatchObject({ source: "built-in", requested: 5 });
    expect(plan.questions).toHaveLength(5);
  });
});
