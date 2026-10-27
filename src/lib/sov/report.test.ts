import { describe, expect, it } from "vitest";
import { analyzeAnswer, buildReport } from "@/lib/sov/report";
import type { Brief, ModelAnswer, Question } from "@/lib/sov/types";

const brief: Brief = {
  product: "Acme",
  category: "CRM",
  audience: "small agencies",
  competitors: ["Pipedrive", "Close"],
  website: "https://www.acme.io",
};

const questions: Question[] = [
  { id: "q1", text: "What is the best CRM for small agencies?", intent: "best-for" },
  { id: "q2", text: "Which CRM do agencies switch to when they outgrow spreadsheets?", intent: "alternatives" },
];

function answer(questionId: string, model: ModelAnswer["model"], text: string, citations: string[] = []): ModelAnswer {
  return { questionId, model, text, citations, source: "mock", latencyMs: 10 };
}

const answers: ModelAnswer[] = [
  answer(
    "q1",
    "chatgpt",
    "1. **Pipedrive** – pipelines.\n2. **Acme** – great for agencies.\n3. **Close** – calling.",
  ),
  answer("q1", "perplexity", "1. **Acme** is excellent for agencies [1].\n2. **Pipedrive** is popular [2].", [
    "https://www.g2.com/categories/crm",
    "https://acme.io/blog/agency-crm",
  ]),
  answer("q2", "chatgpt", "Top alternatives: **Close** and **Pipedrive**."),
  answer("q2", "perplexity", "**Pipedrive** remains the default pick [1].", ["https://www.g2.com/compare/pipedrive"]),
];

describe("analyzeAnswer", () => {
  it("attaches mentions and normalised citations", () => {
    const analyzed = analyzeAnswer(
      answer("q1", "gemini", "**Acme** leads, then Close. Source: https://www.capterra.com/crm", ["https://g2.com/a"]),
      ["Acme", "Close"],
      {},
    );
    expect(analyzed.mentions.map((m) => [m.brand, m.rank])).toEqual([
      ["Acme", 1],
      ["Close", 2],
    ]);
    expect(analyzed.citationList.map((c) => c.domain)).toEqual(["g2.com", "capterra.com"]);
  });

  it("ignores brands that the question itself names", () => {
    const analyzed = analyzeAnswer(
      answer("q9", "claude", "If Pipedrive isn't working out:\n1. **Close**\n2. **Acme**"),
      ["Acme", "Pipedrive", "Close"],
      { questionText: "What are the best alternatives to Pipedrive?" },
    );
    expect(analyzed.mentions.map((m) => [m.brand, m.rank])).toEqual([
      ["Close", 1],
      ["Acme", 2],
    ]);
  });
});

describe("buildReport", () => {
  const report = buildReport({ brief, questions, answers });
  const byBrand = Object.fromEntries(report.brands.map((b) => [b.brand, b]));

  it("counts answers and models", () => {
    expect(report.totalAnswers).toBe(4);
    expect(report.models).toEqual(["chatgpt", "perplexity"]);
  });

  it("computes mention rate per brand", () => {
    expect(byBrand.Pipedrive.mentionRate).toBe(1);
    expect(byBrand.Acme.mentionRate).toBe(0.5);
    expect(byBrand.Close.mentionRate).toBe(0.5);
  });

  it("computes average rank and first-place finishes", () => {
    expect(byBrand.Pipedrive.avgRank).toBe(1.5);
    expect(byBrand.Acme.avgRank).toBe(1.5);
    expect(byBrand.Close.avgRank).toBe(2);
    expect(byBrand.Pipedrive.firstPlace).toBe(2);
    expect(byBrand.Acme.firstPlace).toBe(1);
  });

  it("computes share of voice as a brand's share of all brand mentions", () => {
    expect(byBrand.Pipedrive.shareOfVoice).toBe(0.5);
    expect(byBrand.Acme.shareOfVoice).toBe(0.25);
    expect(byBrand.Close.shareOfVoice).toBe(0.25);
    const total = report.brands.reduce((sum, b) => sum + b.shareOfVoice, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("computes share of voice per model", () => {
    expect(byBrand.Acme.byModel.chatgpt.shareOfVoice).toBeCloseTo(1 / 5, 10);
    expect(byBrand.Acme.byModel.perplexity.shareOfVoice).toBeCloseTo(1 / 3, 10);
    expect(byBrand.Acme.byModel.chatgpt.avgRank).toBe(2);
    expect(byBrand.Acme.byModel.perplexity.mentionRate).toBe(0.5);
    for (const model of report.models) {
      const sum = report.brands.reduce((s, b) => s + b.byModel[model].shareOfVoice, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("orders the leaderboard by share of voice, then average rank", () => {
    expect(report.brands.map((b) => b.brand)).toEqual(["Pipedrive", "Acme", "Close"]);
    expect(report.product.brand).toBe("Acme");
    expect(report.product.isProduct).toBe(true);
    expect(report.productPosition).toBe(2);
    expect(byBrand.Pipedrive.isTrackedCompetitor).toBe(true);
  });

  it("aggregates cited domains and flags the product's own site", () => {
    expect(report.totalCitations).toBe(3);
    expect(report.domains[0]).toMatchObject({ domain: "g2.com", count: 2, models: ["perplexity"], isOwn: false });
    expect(report.domains[0].share).toBeCloseTo(2 / 3, 10);
    expect(report.domains.find((d) => d.domain === "acme.io")?.isOwn).toBe(true);
  });

  it("counts citations of any of the brand's sites, subdomains included, as its own", () => {
    const docs = answer("q2", "perplexity", "See the guide [1].", ["https://docs.acme.dev/agencies", "https://www.g2.com/compare/pipedrive"]);
    const several = buildReport({ brief: { ...brief, otherSites: ["acme.dev"] }, questions, answers: [...answers.slice(0, 3), docs] });
    expect(several.domains.filter((d) => d.isOwn).map((d) => d.domain).sort()).toEqual(["acme.io", "docs.acme.dev"]);
    expect(report.domains.find((d) => d.domain === "docs.acme.dev")).toBeUndefined();
  });

  it("names every site when none of them was cited", () => {
    const uncited = buildReport({ brief: { ...brief, website: "acme.co", otherSites: ["acme.dev"] }, questions, answers });
    expect(uncited.domains.some((d) => d.isOwn)).toBe(false);
    expect(uncited.recommendations.find((r) => r.id === "own-site")?.detail).toMatch(/^No model cited acme\.co or acme\.dev\./);
  });

  it("summarises each model", () => {
    const perplexity = report.modelSummaries.find((m) => m.model === "perplexity")!;
    expect(perplexity.productMentionRate).toBe(0.5);
    expect(perplexity.productAvgRank).toBe(1);
    expect(perplexity.topBrand).toBe("Pipedrive");
    expect(perplexity.citations).toBe(3);
    expect(perplexity.topDomains[0]).toBe("g2.com");
  });

  it("builds prompt-level detail and lists prompts that never mention the product", () => {
    const q1 = report.prompts.find((p) => p.question.id === "q1")!;
    expect(q1.productMentions).toBe(2);
    expect(q1.cells.chatgpt).toMatchObject({ mentioned: true, rank: 2 });
    expect(q1.cells.perplexity).toMatchObject({ mentioned: true, rank: 1 });
    const q2 = report.prompts.find((p) => p.question.id === "q2")!;
    expect(q2.cells.chatgpt).toMatchObject({ mentioned: false, rank: null });
    expect(q2.competitorsMentioned).toEqual(["Pipedrive", "Close"]);
    expect(report.missingPrompts).toEqual(["q2"]);
  });

  it("finds competitor gaps where a rival appears without the product", () => {
    expect(report.gaps).toEqual([
      { competitor: "Pipedrive", gapAnswers: 2, questionIds: ["q2"] },
      { competitor: "Close", gapAnswers: 1, questionIds: ["q2"] },
    ]);
  });

  it("produces prioritised, actionable recommendations", () => {
    const ids = report.recommendations.map((r) => r.id);
    expect(ids).toContain("intent-alternatives");
    expect(ids).toContain("gap-pipedrive");
    expect(report.recommendations[0].priority).toBe("high");
    const order = { high: 0, medium: 1, low: 2 };
    const priorities = report.recommendations.map((r) => order[r.priority]);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    for (const rec of report.recommendations) {
      expect(rec.title.length).toBeGreaterThan(0);
      expect(rec.detail.length).toBeGreaterThan(0);
    }
    expect(report.recommendations.length).toBeLessThanOrEqual(6);
  });

  it("handles a run where nobody gets mentioned", () => {
    const empty = buildReport({
      brief,
      questions,
      answers: [answer("q1", "claude", "It depends on your needs.")],
    });
    expect(empty.product.mentionRate).toBe(0);
    expect(empty.product.avgRank).toBeNull();
    expect(empty.product.shareOfVoice).toBe(0);
    expect(empty.totalCitations).toBe(0);
    expect(empty.recommendations.length).toBeGreaterThan(0);
  });

  it("includes recurring brands discovered in the answers", () => {
    const withExtra = buildReport({
      brief,
      questions,
      answers: [
        ...answers,
        answer("q1", "claude", "1. **Freshsales** – AI scoring.\n2. **Acme** – agency focus."),
        answer("q2", "claude", "- **Freshsales**: cheap.\n- **Close**: calling."),
      ],
    });
    expect(withExtra.brands.map((b) => b.brand)).toContain("Freshsales");
    expect(withExtra.brands.find((b) => b.brand === "Freshsales")?.isTrackedCompetitor).toBe(false);
  });

  it("never counts a research topic as a brand", () => {
    const withTopics = buildReport({
      brief: { ...brief, topics: ["RWA"] },
      questions,
      answers: [
        ...answers,
        answer("q1", "claude", "1. **RWA**: tokenised assets.\n2. **Freshsales** – AI scoring."),
        answer("q2", "claude", "- **RWA**: still early.\n- **Freshsales**: cheap."),
      ],
    });
    expect(withTopics.brands.map((b) => b.brand)).toContain("Freshsales");
    expect(withTopics.brands.map((b) => b.brand)).not.toContain("RWA");
  });

  it("counts a discovered brand's category-suffixed name as the same brand", () => {
    const analytics = buildReport({
      brief: { product: "Plausible", category: "web analytics", audience: "", competitors: [] },
      questions: [{ id: "q1", text: "What's the best web analytics?", intent: "best-for" }],
      answers: [
        answer("q1", "claude", "- **Fathom**: polished.\n- **Plausible**: simple."),
        answer("q1", "gemini", "*   **[Fathom Analytics](https://usefathom.com/):** paid.\n*   **[Plausible Analytics](https://plausible.io/):** simple."),
      ],
    });
    expect(analytics.brands.map((b) => b.brand).sort()).toEqual(["Fathom", "Plausible"]);
    expect(analytics.brands.find((b) => b.brand === "Fathom")?.mentionRate).toBe(1);
    expect(analytics.product.mentionRate).toBe(1);
  });

  it("flags discovered rivals' sites when no competitors were given", () => {
    const discovered = buildReport({
      brief: { product: "Plausible", category: "web analytics", audience: "", competitors: [], website: "plausible.io" },
      questions: [{ id: "q1", text: "What's the best web analytics?", intent: "best-for" }],
      answers: [
        answer("q1", "perplexity", "1. **PostHog**: product analytics.\n2. **Plausible**: simple.", ["https://posthog.com/blog/best", "https://plausible.io/"]),
        answer("q1", "claude", "- **PostHog**: all in one.\n- **Plausible**: light."),
      ],
    });
    expect(discovered.domains.find((d) => d.domain === "posthog.com")?.isCompetitor).toBe(true);
    expect(discovered.domains.find((d) => d.domain === "plausible.io")).toMatchObject({ isOwn: true, isCompetitor: false });
  });

  it("never turns user-written questions into intent tips", () => {
    const custom = buildReport({
      brief,
      questions: [{ id: "c1", text: "Which CRM has the cutest mascot?", intent: "custom" }],
      answers: [answer("c1", "claude", "1. **Close**\n2. **Pipedrive**")],
    });
    expect(custom.recommendations.map((r) => r.id)).not.toContain("intent-custom");
    expect(custom.missingPrompts).toEqual(["c1"]);
  });

  it("gives tips for missed comparison, beginner and use-case questions", () => {
    const missed = buildReport({
      brief,
      questions: [
        { id: "q1", text: "How do the popular CRMs compare?", intent: "comparison" },
        { id: "q2", text: "Which CRM is easiest for a beginner?", intent: "beginner" },
        { id: "q3", text: "Which CRM can track retainers?", intent: "use-case" },
      ],
      answers: ["q1", "q2", "q3"].map((id) => answer(id, "claude", "1. **Close**\n2. **Pipedrive**")),
    });
    const tips = missed.recommendations.filter((r) => r.id.startsWith("intent-"));
    expect(tips).toHaveLength(2);
    expect(tips.map((r) => r.id)).toEqual(["intent-comparison", "intent-beginner"]);
    for (const tip of tips) expect(tip.detail).toContain("Acme");
  });

  it("writes audience-free advice when the audience was skipped", () => {
    const open = buildReport({
      brief: { ...brief, audience: "" },
      questions: [{ id: "q1", text: "What's the best CRM?", intent: "best-for" }],
      answers: [answer("q1", "claude", "1. **Close**\n2. **Pipedrive**"), answer("q1", "gemini", "1. **Pipedrive**\n2. **Close**")],
    });
    const bestFor = open.recommendations.find((r) => r.id === "intent-best-for");
    expect(bestFor?.title).toBe("Win the “best CRM” answer");
    for (const rec of open.recommendations) expect(`${rec.title} ${rec.detail}`).not.toMatch(/for ”| for \.| for so | {2}/);
  });

  it("does not credit a brand for answers to questions that name it", () => {
    const named = buildReport({
      brief,
      questions: [...questions, { id: "q3", text: "What are the best alternatives to Close?", intent: "switching" }],
      answers: [...answers, answer("q3", "chatgpt", "Close is fine, but try:\n1. **Acme**\n2. **Pipedrive**")],
    });
    const close = named.brands.find((b) => b.brand === "Close")!;
    expect(close.mentions).toBe(2);
    expect(named.product.mentions).toBe(3);
    expect(named.prompts.find((p) => p.question.id === "q3")?.cells.chatgpt).toMatchObject({ rank: 1 });
  });
});
