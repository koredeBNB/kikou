import { describe, expect, it } from "vitest";
import { planMessage, writingMessage } from "@/lib/sov/plan-copy";

describe("writingMessage", () => {
  it("says Pip is writing when the plan goes beyond the built-in questions", () => {
    expect(writingMessage({ count: 100 })).toBe("Give me a moment to write 100 buyer questions…");
    expect(writingMessage({ count: 12, topics: ["trading", "RWA", "AI"] })).toBe(
      "Give me a moment to write 12 buyer questions across trading, RWA and AI…",
    );
  });

  it("stays quiet for small broad checks", () => {
    expect(writingMessage({ count: 6 })).toBeNull();
    expect(writingMessage({ count: 4, topics: [] })).toBeNull();
  });
});

describe("planMessage", () => {
  it("introduces a broad plan", () => {
    expect(planMessage({ product: "Trust Wallet", questions: 100, requested: 100 })).toBe(
      "Here's my plan. I'll ask each assistant these 100 questions, the way a real buyer would. None of them name **Trust Wallet**, so every recommendation is unprompted.",
    );
  });

  it("names the topics the questions are split across", () => {
    expect(planMessage({ product: "BNB", questions: 12, requested: 12, topics: ["trading", "RWA", "AI"] })).toBe(
      "Here's my plan: 12 questions split evenly across trading, RWA and AI, the way a real buyer would ask them. None of them name **BNB**, so every recommendation is unprompted.",
    );
  });

  it("owns up when it couldn't write as many distinct questions as asked", () => {
    expect(planMessage({ product: "Acme", questions: 1, requested: 50 })).toContain(
      "I could only come up with 1 distinct question, not 50, so I'll ask that.",
    );
    expect(planMessage({ product: "Acme", questions: 30, requested: 50 })).toContain(
      "I could only come up with 30 distinct questions, not 50, so I'll ask those.",
    );
  });
});
