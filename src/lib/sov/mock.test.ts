import { describe, expect, it } from "vitest";
import { mockAnswer } from "@/lib/sov/mock";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import { buildReport } from "@/lib/sov/report";
import { MODEL_IDS, type Brief } from "@/lib/sov/types";

const brief: Brief = normalizeBrief({
  product: "Acme",
  category: "CRM",
  audience: "small agencies",
  competitors: ["Pipedrive", "Close", "HubSpot"],
  website: "acme.io",
});
const questions = generateQuestions(brief, { year: 2026 });
const answers = questions.flatMap((q) => MODEL_IDS.map((m) => mockAnswer(brief, q, m)));

describe("mockAnswer", () => {
  it("is deterministic for the same brief, question and model", () => {
    expect(mockAnswer(brief, questions[0], "claude")).toEqual(mockAnswer(brief, questions[0], "claude"));
  });

  it("varies between models", () => {
    expect(mockAnswer(brief, questions[0], "claude").text).not.toBe(mockAnswer(brief, questions[0], "chatgpt").text);
  });

  it("marks answers as mock with a plausible latency", () => {
    for (const a of answers) {
      expect(a.source).toBe("mock");
      expect(a.latencyMs).toBeGreaterThan(300);
      expect(a.latencyMs).toBeLessThan(4000);
    }
  });

  it("gives Perplexity answers source citations", () => {
    const perplexity = answers.filter((a) => a.model === "perplexity");
    expect(perplexity.every((a) => a.citations.length >= 3)).toBe(true);
  });

  it("leaves the named competitor out of its own alternatives answer", () => {
    const alt = questions.find((q) => q.intent === "alternatives")!;
    for (const model of MODEL_IDS) {
      const text = mockAnswer(brief, alt, model).text;
      expect(text).toContain("Pipedrive");
      expect(text).not.toMatch(/\*\*Pipedrive\*\*/);
    }
  });

  it("produces a believable report: the product shows up sometimes, not always", () => {
    const report = buildReport({ brief, questions, answers });
    expect(report.product.mentionRate).toBeGreaterThan(0.15);
    expect(report.product.mentionRate).toBeLessThan(0.9);
    expect(report.brands.length).toBeGreaterThanOrEqual(5);
    expect(report.totalCitations).toBeGreaterThan(10);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3);
  });
});
