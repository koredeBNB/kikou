import { describe, expect, it } from "vitest";
import { buildDemoRun, DEMO_BRIEF, DEMO_RUN_ID } from "@/lib/sov/demo";
import { buildReport } from "@/lib/sov/report";
import { MODEL_IDS } from "@/lib/sov/types";

describe("buildDemoRun", () => {
  const run = buildDemoRun(new Date("2026-10-26T09:00:00Z"));

  it("answers every question with every assistant using demo answers", () => {
    expect(run.id).toBe(DEMO_RUN_ID);
    expect(run.brief).toEqual(DEMO_BRIEF);
    expect(run.answers).toHaveLength(run.questions.length * MODEL_IDS.length);
    expect(new Set(run.answers.map((a) => `${a.questionId}:${a.model}`)).size).toBe(run.answers.length);
    expect(run.answers.every((a) => a.source === "mock")).toBe(true);
    expect(run.models.map((m) => m.id)).toEqual([...MODEL_IDS]);
    expect(run.errors).toEqual([]);
  });

  it("is deterministic for the same day", () => {
    expect(buildDemoRun(new Date("2026-10-26T18:00:00Z")).answers).toEqual(run.answers);
  });

  it("produces a report with something to act on", () => {
    const report = buildReport({ brief: run.brief, questions: run.questions, answers: run.answers });
    expect(report.product.mentionRate).toBeGreaterThan(0);
    expect(report.product.mentionRate).toBeLessThan(1);
    expect(report.brands.length).toBeGreaterThan(3);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.totalCitations).toBeGreaterThan(0);
  });
});
