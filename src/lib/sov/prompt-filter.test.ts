import { describe, expect, it } from "vitest";
import { filterPrompts, pageOf, PROMPTS_PER_PAGE } from "@/lib/sov/prompt-filter";
import type { PromptRow, Question } from "@/lib/sov/types";

function row(id: string, productMentions: number, answers: number, topic?: string): PromptRow {
  const question: Question = { id, text: `Question ${id}?`, intent: "best-for", ...(topic ? { topic } : {}) };
  return { question, cells: {}, productMentions, answers, competitorsMentioned: [] };
}

const rows = [row("q1", 2, 2, "trading"), row("q2", 0, 2, "trading"), row("q3", 1, 2, "RWA"), row("q4", 0, 0, "RWA"), row("q5", 0, 1)];

describe("filterPrompts", () => {
  it("keeps every row for all", () => {
    expect(filterPrompts(rows, { status: "all" }).map((r) => r.question.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("finds questions where at least one assistant left you out", () => {
    expect(filterPrompts(rows, { status: "missing" }).map((r) => r.question.id)).toEqual(["q2", "q3", "q5"]);
  });

  it("finds questions where at least one assistant named you", () => {
    expect(filterPrompts(rows, { status: "named" }).map((r) => r.question.id)).toEqual(["q1", "q3"]);
  });

  it("narrows to one topic, combined with the status", () => {
    expect(filterPrompts(rows, { status: "all", topic: "RWA" }).map((r) => r.question.id)).toEqual(["q3", "q4"]);
    expect(filterPrompts(rows, { status: "missing", topic: "trading" }).map((r) => r.question.id)).toEqual(["q2"]);
  });
});

describe("pageOf", () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  it("shows 20 per page", () => {
    expect(PROMPTS_PER_PAGE).toBe(20);
    expect(pageOf(items, 0)).toMatchObject({ page: 0, pages: 3, start: 0 });
    expect(pageOf(items, 0).items).toHaveLength(20);
    expect(pageOf(items, 2).items).toEqual([40, 41, 42, 43, 44]);
  });

  it("clamps the page into range, so a narrower filter never shows an empty page", () => {
    expect(pageOf(items, 9).page).toBe(2);
    expect(pageOf(items, -1).page).toBe(0);
    expect(pageOf([], 3)).toMatchObject({ items: [], page: 0, pages: 1, start: 0 });
  });
});
