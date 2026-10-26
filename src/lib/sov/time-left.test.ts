import { describe, expect, it } from "vitest";
import { secondsLeft, timeLeft, type TimeLeftInput } from "@/lib/sov/time-left";
import type { ModelId } from "@/lib/sov/types";

const MODELS: ModelId[] = ["chatgpt", "claude", "gemini", "perplexity"];

function progress(elapsedS: number, done: Partial<Record<ModelId, number>>, latencyS: Partial<Record<ModelId, number>> = {}): TimeLeftInput {
  return {
    elapsedMs: elapsedS * 1000,
    models: MODELS,
    questions: 100,
    answers: MODELS.flatMap((model) => Array.from({ length: done[model] ?? 0 }, () => ({ model, latencyMs: (latencyS[model] ?? 5) * 1000 }))),
    errors: [],
  };
}

describe("time left on a running check", () => {
  it("goes by the slowest assistant's pace, not the overall pace", () => {
    // 78 s into the live Trust Wallet check: 187 of 400 in, but ChatGPT only 23 of 100. 3 min 17 s remained.
    const input = progress(78, { chatgpt: 23, claude: 45, gemini: 65, perplexity: 54 }, { chatgpt: 12.6 });
    expect(secondsLeft(input)).toBeCloseTo((78 / 23) * 77, 5);
    expect(timeLeft(input)).toBe("about 4 minutes left");
  });

  it("ignores assistants that have finished", () => {
    const input = progress(120, { chatgpt: 70, claude: 100, gemini: 100, perplexity: 100 });
    expect(secondsLeft(input)).toBeCloseTo((120 / 70) * 30, 5);
  });

  it("never promises less than one more answer from the slowest assistant still working", () => {
    const input = progress(300, { chatgpt: 99, claude: 100, gemini: 100, perplexity: 100 }, { chatgpt: 70 });
    expect(secondsLeft(input)).toBe(70);
    expect(timeLeft(input)).toBe("about a minute left");
  });

  it("counts failed answers as done", () => {
    const input = { ...progress(100, { chatgpt: 40, claude: 100, gemini: 100, perplexity: 100 }), errors: Array.from({ length: 10 }, () => ({ model: "chatgpt" as const })) };
    expect(secondsLeft(input)).toBeCloseTo((100 / 50) * 50, 5);
  });

  it("waits until every assistant still working has a few answers in", () => {
    expect(timeLeft(progress(20, { chatgpt: 2, claude: 9, gemini: 14, perplexity: 11 }))).toBeNull();
    expect(timeLeft(progress(20, { chatgpt: 3, claude: 9, gemini: 14, perplexity: 11 }))).not.toBeNull();
  });

  it("says nothing once every answer is in", () => {
    expect(timeLeft(progress(272, { chatgpt: 100, claude: 100, gemini: 100, perplexity: 100 }))).toBeNull();
  });

  it("rounds to friendly phrases", () => {
    expect(timeLeft(progress(100, { chatgpt: 90, claude: 100, gemini: 100, perplexity: 100 }))).toBe("almost done");
    expect(timeLeft(progress(100, { chatgpt: 60, claude: 100, gemini: 100, perplexity: 100 }))).toBe("about a minute left");
    expect(timeLeft(progress(100, { chatgpt: 35, claude: 100, gemini: 100, perplexity: 100 }))).toBe("about 3 minutes left");
  });
});
