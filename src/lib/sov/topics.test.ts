import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/sov/report";
import { buildTopicBreakdown } from "@/lib/sov/topics";
import type { Brief, ModelAnswer, Question } from "@/lib/sov/types";

const brief: Brief = {
  product: "BNB",
  category: "crypto",
  audience: "",
  competitors: ["Ethereum"],
  website: "bnbchain.org",
  topics: ["trading", "RWA"],
};

const questions: Question[] = [
  { id: "q1", text: "Which crypto is best for active trading?", intent: "best-for", topic: "trading" },
  { id: "q2", text: "What's the cheapest chain for frequent trades?", intent: "budget", topic: "trading" },
  { id: "q3", text: "Which chain leads for tokenised real-world assets?", intent: "best-for", topic: "RWA" },
  { id: "q4", text: "Where do funds issue tokenised treasuries?", intent: "use-case", topic: "RWA" },
  { id: "c5", text: "Is there a chain my bank uses?", intent: "custom" },
];

function answer(questionId: string, model: ModelAnswer["model"], text: string, citations: string[] = []): ModelAnswer {
  return { questionId, model, text, citations, source: "mock", latencyMs: 10 };
}

const answers: ModelAnswer[] = [
  answer("q1", "chatgpt", "1. **BNB** – deep liquidity.\n2. **Ethereum** – most pairs.\n3. **Solana** – fast fills."),
  answer("q1", "perplexity", "1. **BNB** is a favourite [1].\n2. **Solana** is close behind [2].", ["https://www.coindesk.com/a", "https://bnbchain.org/x"]),
  answer("q2", "chatgpt", "1. **Solana** – tiny fees.\n2. **BNB** – cheap too."),
  answer("q2", "perplexity", "1. **BNB** keeps fees low [1].", ["https://www.coindesk.com/b"]),
  answer("q3", "chatgpt", "1. **Ethereum** – most RWA issuance.\n2. **Polygon** – cheap issuance.\n3. **Solana** – growing."),
  answer("q3", "perplexity", "1. **Ethereum** dominates [1].\n2. **Polygon** follows [2].", ["https://rwa.xyz/a", "https://rwa.xyz/b"]),
  answer("q4", "chatgpt", "1. **Ethereum** – BlackRock's BUIDL.\n2. **Polygon** – Franklin Templeton."),
  answer("q4", "perplexity", "1. **Ethereum** hosts most treasuries [1].", ["https://www.theblock.co/rwa"]),
  answer("c5", "chatgpt", "1. **BNB** is used by some."),
];

describe("buildTopicBreakdown", () => {
  it("returns nothing for a broad check", () => {
    const broad = { ...brief, topics: undefined };
    const plain = questions.map((q) => ({ ...q, topic: undefined }));
    expect(buildTopicBreakdown({ brief: broad, questions: plain, answers })).toEqual([]);
  });

  it("scores each topic on its own questions, in the brief's order", () => {
    const [trading, rwa] = buildTopicBreakdown({ brief, questions, answers });

    expect(trading.topic).toBe("trading");
    expect(trading.questions).toBe(2);
    expect(trading.answers).toBe(4);
    expect(trading.mentions).toBe(4);
    expect(trading.mentionRate).toBe(1);
    expect(trading.position).toBe(1);
    expect(trading.leaders[0]).toMatchObject({ brand: "BNB", isProduct: true });
    expect(trading.avgRank).toBeCloseTo(1.25);

    expect(rwa.topic).toBe("RWA");
    expect(rwa.answers).toBe(4);
    expect(rwa.mentions).toBe(0);
    expect(rwa.mentionRate).toBe(0);
    expect(rwa.shareOfVoice).toBe(0);
    expect(rwa.position).toBeNull();
    expect(rwa.leaders.map((l) => l.brand).slice(0, 2)).toEqual(["Ethereum", "Polygon"]);
  });

  it("uses the whole check's rivals, so a brand found elsewhere still counts in a topic", () => {
    const overall = buildReport({ brief, questions, answers });
    expect(overall.brands.map((b) => b.brand)).toContain("Solana");
    const [, rwa] = buildTopicBreakdown({ brief, questions, answers });
    expect(rwa.leaders.map((l) => l.brand)).toEqual(["Ethereum", "Polygon", "Solana"]);
    expect(rwa.brandsRanked).toBe(3);
  });

  it("lists each topic's most cited sources and flags your own site", () => {
    const [trading, rwa] = buildTopicBreakdown({ brief, questions, answers });
    expect(trading.topDomains[0]).toMatchObject({ domain: "coindesk.com", count: 2, isOwn: false });
    expect(trading.topDomains.find((d) => d.domain === "bnbchain.org")?.isOwn).toBe(true);
    expect(rwa.topDomains.map((d) => d.domain)).toEqual(["rwa.xyz", "theblock.co"]);
  });

  it("suggests topic-specific improvements, without the generic re-run tip", () => {
    const [trading, rwa] = buildTopicBreakdown({ brief, questions, answers });
    expect(rwa.improvements.length).toBeGreaterThan(0);
    expect(rwa.improvements.length).toBeLessThanOrEqual(2);
    expect(rwa.improvements[0].priority).toBe("high");
    for (const topic of [trading, rwa]) expect(topic.improvements.map((r) => r.id)).not.toContain("monitor");
  });

  it("skips topics with no questions and leaves untagged questions out", () => {
    const withExtra = { ...brief, topics: ["trading", "RWA", "AI"] };
    const topics = buildTopicBreakdown({ brief: withExtra, questions, answers });
    expect(topics.map((t) => t.topic)).toEqual(["trading", "RWA"]);
    expect(topics.reduce((s, t) => s + t.answers, 0)).toBe(8);
  });
});
