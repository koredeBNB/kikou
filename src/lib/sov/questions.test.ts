import { describe, expect, it } from "vitest";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import type { Brief } from "@/lib/sov/types";

const brief: Brief = {
  product: "Acme",
  category: "a CRM",
  audience: "for small agencies",
  competitors: ["Pipedrive", "Close"],
};

describe("normalizeBrief", () => {
  it("strips leading articles and 'for' and trims competitor lists", () => {
    expect(normalizeBrief({ ...brief, competitors: [" Pipedrive ", "", "acme", "Close", "close"] })).toEqual({
      product: "Acme",
      category: "CRM",
      audience: "small agencies",
      competitors: ["Pipedrive", "Close"],
      website: undefined,
    });
  });
});

describe("generateQuestions", () => {
  const questions = generateQuestions(normalizeBrief(brief), { year: 2026 });

  it("creates six buyer-style questions with unique ids and intents", () => {
    expect(questions).toHaveLength(6);
    expect(new Set(questions.map((q) => q.id)).size).toBe(6);
    expect(new Set(questions.map((q) => q.intent)).size).toBe(6);
  });

  it("never names the product, so answers are unprompted", () => {
    for (const q of questions) expect(q.text.toLowerCase()).not.toContain("acme");
  });

  it("uses the category, audience and the first competitor", () => {
    expect(questions[0].text).toBe("What's the best CRM for small agencies?");
    expect(questions.find((q) => q.intent === "alternatives")?.text).toBe(
      "What are the best alternatives to Pipedrive?",
    );
    expect(questions.find((q) => q.intent === "top-list")?.text).toContain("2026");
  });

  it("reads naturally when the audience was skipped", () => {
    const open = generateQuestions(normalizeBrief({ ...brief, audience: "" }), { year: 2026 });
    expect(open.map((q) => q.text)).toEqual([
      "What's the best CRM?",
      "Which CRM options are the most recommended in 2026?",
      "What are the best alternatives to Pipedrive?",
      "What's the most affordable CRM that still works well?",
      "We're thinking of leaving Close. Which CRM should we switch to?",
      "Which CRM stands out on features and ease of use?",
    ]);
    const generic = generateQuestions(normalizeBrief({ ...brief, audience: "", competitors: [] }), { year: 2026 });
    expect(generic.find((q) => q.intent === "switching")?.text).toBe("We're outgrowing our current CRM. What should we switch to?");
  });

  it("falls back to generic phrasing when no competitors are known", () => {
    const generic = generateQuestions(normalizeBrief({ ...brief, competitors: [] }), { year: 2026 });
    expect(generic).toHaveLength(6);
    expect(generic.find((q) => q.intent === "alternatives")?.text).toBe(
      "What are good alternatives to the most popular CRM?",
    );
  });
});
