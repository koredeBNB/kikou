import { describe, expect, it } from "vitest";
import {
  ANSWER_RATES,
  PER_MODEL_CONCURRENCY,
  answerCost,
  estimateCheck,
  estimateLine,
  formatDuration,
  formatUsd,
  type EstimateModel,
  type RateTable,
} from "@/lib/sov/estimate";
import { MODEL_IDS, type ModelId } from "@/lib/sov/types";

const live = (id: ModelId, webSearch = true): EstimateModel => ({ id, live: true, webSearch });
const everyone = MODEL_IDS.map((id) => live(id));

const flat: RateTable = {
  chatgpt: { search: { costUsd: 0.03, seconds: 12 }, plain: { costUsd: 0.002, seconds: 9 } },
  claude: { search: { costUsd: 0.02, seconds: 10 }, plain: { costUsd: 0.003, seconds: 6 } },
  gemini: { search: { costUsd: 0.05, seconds: 7 }, plain: { costUsd: 0.001, seconds: 5 } },
  perplexity: { search: { costUsd: 0.015, seconds: 4 }, plain: { costUsd: 0.015, seconds: 4 } },
};

describe("estimateCheck", () => {
  it("counts every question once per assistant", () => {
    expect(estimateCheck({ questions: 100, models: everyone, webSearch: true }).answers).toBe(400);
    expect(estimateCheck({ questions: 7, models: [live("claude")], webSearch: true }).answers).toBe(7);
  });

  it("adds up each assistant's average cost per answer with web search", () => {
    const estimate = estimateCheck({ questions: 100, models: everyone, webSearch: true }, flat);
    expect(estimate.costUsd).toBeCloseTo(100 * (0.03 + 0.02 + 0.05 + 0.015), 6);
    expect(estimate.perModel.find((m) => m.model === "gemini")?.costUsd).toBeCloseTo(5, 6);
  });

  it("uses the no-search rates when web search is off, except for Perplexity, which always searches", () => {
    const estimate = estimateCheck({ questions: 10, models: everyone, webSearch: false }, flat);
    expect(estimate.costUsd).toBeCloseTo(10 * (0.002 + 0.003 + 0.001 + 0.015), 6);
  });

  it("uses the no-search rate for an assistant whose server has web search off", () => {
    const estimate = estimateCheck({ questions: 10, models: [live("chatgpt", false)], webSearch: true }, flat);
    expect(estimate.costUsd).toBeCloseTo(0.02, 6);
  });

  it("charges nothing for demo assistants", () => {
    const estimate = estimateCheck({ questions: 50, models: [{ id: "claude", live: false, webSearch: false }], webSearch: true }, flat);
    expect(estimate.costUsd).toBe(0);
    expect(estimate.answers).toBe(50);
  });

  it("times the check by its slowest assistant, each working through its questions a few at a time", () => {
    const estimate = estimateCheck({ questions: 100, models: everyone, webSearch: true }, flat);
    const rounds = Math.ceil(100 / PER_MODEL_CONCURRENCY);
    expect(estimate.seconds).toBe(rounds * 12);
    expect(estimateCheck({ questions: 1, models: [live("perplexity")], webSearch: false }, flat).seconds).toBe(4);
  });

  it("has a measured rate for every assistant", () => {
    for (const id of MODEL_IDS) {
      for (const rate of [ANSWER_RATES[id].search, ANSWER_RATES[id].plain]) {
        expect(rate.costUsd).toBeGreaterThan(0);
        expect(rate.seconds).toBeGreaterThan(0);
      }
    }
    const perQuestion = MODEL_IDS.reduce((sum, id) => sum + ANSWER_RATES[id].search.costUsd, 0);
    expect(perQuestion * 100).toBeGreaterThan(5);
    expect(perQuestion * 100).toBeLessThan(20);
  });
});

describe("formatting", () => {
  it("formats dollars to the cent", () => {
    expect(formatUsd(11.5)).toBe("$11.50");
    expect(formatUsd(0.404)).toBe("$0.40");
    expect(formatUsd(20)).toBe("$20.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("rounds durations the way people say them", () => {
    expect(formatDuration(20)).toBe("under a minute");
    expect(formatDuration(70)).toBe("roughly a minute");
    expect(formatDuration(150)).toBe("roughly 3 minutes");
    expect(formatDuration(12 * 60 + 10)).toBe("roughly 12 minutes");
  });
});

describe("estimateLine", () => {
  const estimate = { answers: 400, costUsd: 11.5, seconds: 12 * 60, perModel: [] };

  it("spells out the answers, the cost and the time, then asks to go ahead", () => {
    expect(estimateLine({ questions: 100, assistants: 4, estimate })).toBe(
      "100 questions to 4 AIs is 400 answers. That's about $11.50 and roughly 12 minutes. Go ahead?",
    );
  });

  it("handles one of each and tiny costs", () => {
    expect(estimateLine({ questions: 1, assistants: 1, estimate: { answers: 1, costUsd: 0.004, seconds: 8, perModel: [] } })).toBe(
      "1 question to 1 AI is 1 answer. That's less than a cent and under a minute. Go ahead?",
    );
  });

  it("says demo answers are free", () => {
    expect(estimateLine({ questions: 6, assistants: 4, estimate: { answers: 24, costUsd: 0, seconds: 10, perModel: [] } })).toBe(
      "6 questions to 4 AIs is 24 answers. They're demo answers, so it's free and takes under a minute. Go ahead?",
    );
  });
});

describe("answerCost", () => {
  it("uses the cost the provider reported", () => {
    expect(answerCost({ model: "claude", source: "live", costUsd: 0.0123 }, true)).toBe(0.0123);
  });

  it("falls back to the assistant's average when no cost was reported, and charges nothing for demo answers", () => {
    expect(answerCost({ model: "gemini", source: "live" }, true)).toBe(ANSWER_RATES.gemini.search.costUsd);
    expect(answerCost({ model: "gemini", source: "live" }, false)).toBe(ANSWER_RATES.gemini.plain.costUsd);
    expect(answerCost({ model: "gemini", source: "mock" }, true)).toBe(0);
  });
});
