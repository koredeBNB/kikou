import { describe, expect, it } from "vitest";
import { AI_BOTS, CRAWLER_POINTS, botsFor } from "@/lib/audit/bots";
import { MODEL_IDS } from "@/lib/sov/types";

describe("AI_BOTS", () => {
  it("weighs the bots to the crawler access points", () => {
    const total = AI_BOTS.reduce((sum, bot) => sum + bot.weight, 0);
    expect(total).toBeCloseTo(CRAWLER_POINTS, 5);
  });

  it("gives every assistant a search crawler that outweighs its training crawler", () => {
    for (const model of MODEL_IDS) {
      const bots = botsFor(model);
      const search = bots.find((b) => b.role === "search");
      expect(search, model).toBeDefined();
      for (const training of bots.filter((b) => b.role === "training")) expect(search!.weight).toBeGreaterThan(training.weight);
    }
  });

  it("only probes bots that crawl under their own name", () => {
    const extended = AI_BOTS.find((b) => b.token === "Google-Extended");
    expect(extended?.userAgent).toBeUndefined();
    for (const bot of AI_BOTS.filter((b) => b.token !== "Google-Extended")) expect(bot.userAgent).toContain(bot.token);
  });

  it("has unique tokens", () => {
    const tokens = AI_BOTS.map((b) => b.token.toLowerCase());
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
