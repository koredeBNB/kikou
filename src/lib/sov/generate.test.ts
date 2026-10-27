import { describe, expect, it, vi } from "vitest";
import {
  BATCH_SIZE,
  buildQuestionPrompt,
  classifyIntent,
  cleanGeneratedQuestions,
  planQuestions,
  questionSlots,
  readQuestionList,
  templateQuestions,
  type GenerationRequest,
  type QuestionWriter,
} from "@/lib/sov/generate";
import type { Brief } from "@/lib/sov/types";

const wallet: Brief = {
  product: "Trust Wallet",
  category: "crypto wallet",
  audience: "",
  competitors: ["MetaMask", "Coinbase Wallet"],
  website: "trustwallet.com",
};

const SUBJECTS = [
  "storing Bitcoin",
  "a first NFT",
  "daily DeFi trades",
  "family savings",
  "travel abroad",
  "a small business",
  "long-term holding",
  "earning yield",
  "phone-only use",
  "hardware backups",
  "privacy",
  "multiple chains",
  "low fees",
  "fast swaps",
  "gaming tokens",
  "stablecoin payments",
  "teenagers learning crypto",
  "retirees",
  "airdrops",
  "cross-chain bridges",
];
const STARTS = ["Which", "What's a good", "Can you recommend a", "Is there a reliable", "Where can I find a"];

/** Distinct, unbranded questions, so a fake writer can return as many as asked. */
function distinct(prefix: string, count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, i) => {
    const k = i + offset;
    return `${STARTS[k % STARTS.length]} crypto wallet for ${SUBJECTS[k % SUBJECTS.length]} ${prefix} case ${k}?`;
  });
}

function fakeWriter(produce: (request: GenerationRequest, call: number) => unknown) {
  const requests: GenerationRequest[] = [];
  const write: QuestionWriter = vi.fn(async (request: GenerationRequest) => {
    requests.push(request);
    return produce(request, requests.length);
  });
  return { write, requests };
}

describe("questionSlots", () => {
  it("asks everything as one broad slot without topics", () => {
    expect(questionSlots(100, [])).toEqual([{ count: 100 }]);
    expect(questionSlots(7)).toEqual([{ count: 7 }]);
  });

  it("splits the questions evenly across topics, earlier topics taking the remainder", () => {
    expect(questionSlots(10, ["trading", "RWA", "AI"])).toEqual([
      { topic: "trading", count: 4 },
      { topic: "RWA", count: 3 },
      { topic: "AI", count: 3 },
    ]);
    expect(questionSlots(100, ["a", "b", "c", "d", "e"]).map((s) => s.count)).toEqual([20, 20, 20, 20, 20]);
  });

  it("drops topics that would get no questions", () => {
    expect(questionSlots(2, ["trading", "RWA", "AI"])).toEqual([
      { topic: "trading", count: 1 },
      { topic: "RWA", count: 1 },
    ]);
  });
});

describe("classifyIntent", () => {
  it.each([
    ["What are the best alternatives to MetaMask?", "alternatives"],
    ["MetaMask vs Coinbase Wallet: which is safer?", "comparison"],
    ["How do the popular crypto wallets compare on fees?", "comparison"],
    ["Between Ledger and Trezor, which is better for long-term storage?", "comparison"],
    ["I'm moving away from my exchange wallet. Where should I switch?", "switching"],
    ["What's the cheapest crypto wallet to send stablecoins?", "budget"],
    ["Which crypto wallet is easiest for a complete beginner?", "beginner"],
    ["What are the most popular crypto wallets right now?", "top-list"],
    ["What's the best crypto wallet for staking Ethereum?", "best-for"],
    ["Which crypto wallet has the strongest security features?", "features"],
    ["I want to pay freelancers in USDC. Which wallet should I use?", "use-case"],
  ])("reads %s as %s", (text, intent) => {
    expect(classifyIntent(text)).toBe(intent);
  });
});

describe("cleanGeneratedQuestions", () => {
  it("strips numbering, bullets and quotes, and ends every question with a question mark", () => {
    expect(
      cleanGeneratedQuestions(["1. Which crypto wallet is best for staking?", "- “What's a safe wallet for a first NFT”"], { brief: wallet }),
    ).toEqual(["Which crypto wallet is best for staking?", "What's a safe wallet for a first NFT?"]);
  });

  it("ends plain requests with a full stop, unless they also ask something", () => {
    expect(
      cleanGeneratedQuestions(
        [
          "Recommend a wallet for DeFi farming",
          "Compare the fees of the top three crypto wallets for small trades?",
          "Help me pick a wallet for my parents, which one is simplest?",
        ],
        { brief: wallet },
      ),
    ).toEqual([
      "Recommend a wallet for DeFi farming.",
      "Compare the fees of the top three crypto wallets for small trades.",
      "Help me pick a wallet for my parents, which one is simplest?",
    ]);
  });

  it("never keeps a question that names the product, its site or its squashed name", () => {
    const kept = cleanGeneratedQuestions(
      [
        "Is Trust Wallet good for beginners?",
        "How does trustwallet.com handle support tickets?",
        "Should I install TrustWallet or a hardware wallet?",
        "Is trust-wallet safe for storing Solana?",
        "Which wallet can I trust with my life savings?",
      ],
      { brief: wallet },
    );
    expect(kept).toEqual(["Which wallet can I trust with my life savings?"]);
  });

  it("also drops questions naming any of the brand's other sites", () => {
    const kept = cleanGeneratedQuestions(
      ["Is staking on stake.twt.finance worth it?", "Should I hold TWT for lower wallet fees?", "Which crypto wallet has the lowest fees?"],
      { brief: { ...wallet, otherSites: ["twt.finance"] } },
    );
    expect(kept).toEqual(["Which crypto wallet has the lowest fees?"]);
  });

  it("drops blanks, non-strings, very short and very long questions", () => {
    expect(cleanGeneratedQuestions(["", 42, null, "Best?", `Which wallet ${"is really ".repeat(30)}good?`], { brief: wallet })).toEqual([]);
  });

  it("removes exact and near duplicates, including ones already planned", () => {
    const kept = cleanGeneratedQuestions(
      [
        "What's the best crypto wallet for beginners?",
        "Which crypto wallet is best for beginners?",
        "what's the best crypto wallet for beginners",
        "What's the cheapest crypto wallet for beginners?",
        "Which crypto wallet has the lowest fees?",
      ],
      { brief: wallet, existing: ["Which crypto wallet has the lowest fees?"] },
    );
    expect(kept).toEqual(["What's the best crypto wallet for beginners?", "What's the cheapest crypto wallet for beginners?"]);
  });

  it("limits how many questions name a competitor, and how many it returns", () => {
    const raw = [
      "What are the best alternatives to MetaMask?",
      "Is Coinbase Wallet better than a hardware wallet for long-term holding?",
      "MetaMask vs Coinbase Wallet: which suits a DeFi beginner?",
      "Which crypto wallet works best for daily DeFi trades?",
      "Which crypto wallet is best for storing Bitcoin offline?",
    ];
    const kept = cleanGeneratedQuestions(raw, { brief: wallet, maxNamingCompetitors: 1, limit: 3 });
    expect(kept).toEqual([
      "What are the best alternatives to MetaMask?",
      "Which crypto wallet works best for daily DeFi trades?",
      "Which crypto wallet is best for storing Bitcoin offline?",
    ]);
  });
});

describe("readQuestionList", () => {
  it("accepts a JSON string, an object or a bare list", () => {
    expect(readQuestionList(JSON.stringify({ questions: ["a?", "b?"] }))).toEqual(["a?", "b?"]);
    expect(readQuestionList({ questions: ["a?"] })).toEqual(["a?"]);
    expect(readQuestionList(["a?"])).toEqual(["a?"]);
    expect(readQuestionList("not json")).toEqual([]);
    expect(readQuestionList({ nope: 1 })).toEqual([]);
  });
});

describe("templateQuestions", () => {
  it("offers plenty of distinct, unbranded broad questions", () => {
    const texts = cleanGeneratedQuestions(templateQuestions(wallet, { year: 2026 }), { brief: wallet });
    expect(texts.length).toBeGreaterThanOrEqual(20);
    for (const text of texts) expect(text.toLowerCase()).not.toContain("trust wallet");
  });

  it("writes every topic question about the topic", () => {
    const texts = templateQuestions(wallet, { topic: "staking", year: 2026 });
    expect(texts.length).toBeGreaterThanOrEqual(8);
    for (const text of texts) expect(text).toContain("staking");
  });
});

describe("buildQuestionPrompt", () => {
  it("tells the writer what never to mention, how many to write and what to cover", () => {
    const prompt = buildQuestionPrompt({
      category: "crypto wallet",
      audience: "",
      competitors: ["MetaMask"],
      product: "Trust Wallet",
      website: "trustwallet.com",
      topic: "staking",
      angle: "beginners, budget, pricing and value for money",
      count: 12,
      avoid: ["Which crypto wallet is best for staking?"],
      year: 2026,
    });
    expect(prompt.system).toContain("It's 2026, but rarely mention a year");
    expect(prompt.system).toContain("No general how-to or explainer questions");
    expect(prompt.system).toContain("Never mention “Trust Wallet”");
    expect(prompt.system).toContain("trustwallet.com");
    expect(prompt.system).toContain("exactly 12");
    expect(prompt.system).toContain("staking");
    expect(prompt.system).toContain("beginners, budget");
    expect(prompt.system).toContain("MetaMask");
    expect(JSON.parse(prompt.user)).toMatchObject({ category: "crypto wallet", topic: "staking", count: 12, avoid: ["Which crypto wallet is best for staking?"] });
  });

  it("names every one of the brand's sites as off limits", () => {
    const prompt = buildQuestionPrompt({
      category: "crypto wallet",
      audience: "",
      competitors: [],
      product: "Trust Wallet",
      website: "trustwallet.com",
      otherSites: ["twt.finance"],
      angle: "a mix",
      count: 5,
      avoid: [],
    });
    expect(prompt.system).toContain("Never mention “Trust Wallet” or trustwallet.com or twt.finance");
  });

  it("asks for no brand names at all when there are no competitors", () => {
    const prompt = buildQuestionPrompt({ category: "CRM", audience: "agencies", competitors: [], product: "Acme", angle: "a mix", count: 5, avoid: [] });
    expect(prompt.system).toContain("Don't name any brands");
  });
});

describe("planQuestions", () => {
  it("uses the built-in questions for small broad checks, without calling the writer", async () => {
    const { write } = fakeWriter(() => []);
    const plan = await planQuestions(wallet, 4, { write, year: 2026 });
    expect(plan.source).toBe("built-in");
    expect(plan.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("tops up the built-in set with written questions in batches of at most 25", async () => {
    const { write, requests } = fakeWriter((request, call) => ({ questions: distinct(`b${call}`, request.count, call * 40) }));
    const plan = await planQuestions(wallet, 100, { write, year: 2026 });

    expect(plan.source).toBe("ai");
    expect(plan.questions).toHaveLength(100);
    expect(plan.questions.slice(0, 6).map((q) => q.intent)).toEqual(["best-for", "top-list", "alternatives", "budget", "switching", "features"]);
    expect(new Set(plan.questions.map((q) => q.id)).size).toBe(100);
    expect(plan.questions.at(-1)?.id).toBe("q100");
    for (const q of plan.questions) {
      expect(q.text.toLowerCase()).not.toContain("trust wallet");
      expect(q.topic).toBeUndefined();
    }
    expect(requests.length).toBe(Math.ceil(94 / BATCH_SIZE));
    for (const request of requests) {
      expect(request.product).toBe("Trust Wallet");
      expect(request.year).toBe(2026);
      expect(request.topic).toBeUndefined();
      expect(request.count).toBeLessThanOrEqual(34);
    }
    expect(new Set(requests.map((r) => r.angle)).size).toBe(requests.length);
  });

  it("asks once more for what's missing when the writer comes back short, then fills from templates", async () => {
    const { write, requests } = fakeWriter((request, call) => (call === 1 ? distinct("first", 5) : distinct("again", 2, 60)));
    const plan = await planQuestions(wallet, 20, { write, year: 2026 });
    expect(requests).toHaveLength(2);
    expect(requests[1].avoid).toEqual(expect.arrayContaining(distinct("first", 5)));
    expect(plan.questions).toHaveLength(20);
    expect(plan.source).toBe("mixed");
  });

  it("falls back to templates when the writer fails", async () => {
    const write: QuestionWriter = vi.fn(async () => {
      throw new Error("timeout");
    });
    const plan = await planQuestions(wallet, 25, { write, year: 2026 });
    expect(plan.source).toBe("templates");
    expect(plan.questions).toHaveLength(25);
    expect(write).toHaveBeenCalledTimes(1);
    for (const q of plan.questions) expect(q.text.toLowerCase()).not.toContain("trust wallet");
  });

  it("works with no writer at all", async () => {
    const plan = await planQuestions(wallet, 12, { year: 2026 });
    expect(plan.source).toBe("templates");
    expect(plan.questions).toHaveLength(12);
  });

  it("writes every question per topic, split evenly and tagged with its topic", async () => {
    const brief = { ...wallet, product: "BNB", category: "crypto", website: undefined, topics: ["trading", "RWA", "AI"] };
    const { write, requests } = fakeWriter((request) => ({
      questions: Array.from({ length: request.count }, (_, i) => `Which crypto is best for ${request.topic} use number ${i + 1}?`),
    }));
    const plan = await planQuestions(brief, 10, { write, year: 2026 });

    expect(plan.source).toBe("ai");
    expect(plan.questions).toHaveLength(10);
    expect(plan.questions.map((q) => q.topic)).toEqual(["trading", "trading", "trading", "trading", "RWA", "RWA", "RWA", "AI", "AI", "AI"]);
    expect(requests.map((r) => r.topic)).toEqual(["trading", "RWA", "AI"]);
    for (const q of plan.questions) expect(q.text).toContain(q.topic!);
  });

  it("keeps topic plans honest when templates can't fill a slot", async () => {
    const brief = { ...wallet, topics: ["staking"] };
    const plan = await planQuestions(brief, 100, { year: 2026 });
    expect(plan.questions.length).toBeLessThan(100);
    expect(plan.questions.length).toBeGreaterThan(0);
    expect(plan.requested).toBe(100);
    expect(new Set(plan.questions.map((q) => q.text)).size).toBe(plan.questions.length);
  });
});
