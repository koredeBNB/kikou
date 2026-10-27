import { describe, expect, it } from "vitest";
import { validateCheckRequest, validateQuestionRequest } from "@/lib/sov/validate";

const valid = {
  brief: { product: "Acme", category: "CRM", audience: "agencies", competitors: ["Close", 3, ""] },
  questions: [{ id: "q1", text: "Best CRM?", intent: "best-for" }],
};

describe("validateCheckRequest", () => {
  it("accepts a valid request and defaults to every model", () => {
    const result = validateCheckRequest(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models).toEqual(["chatgpt", "claude", "gemini", "perplexity"]);
    expect(result.value.brief.competitors).toEqual(["Close"]);
  });

  it("keeps a skipped audience empty instead of inventing one", () => {
    const result = validateCheckRequest({ ...valid, brief: { ...valid.brief, audience: "" } });
    expect(result.ok && result.value.brief.audience).toBe("");
  });

  it("requires a product, a category and at least one question", () => {
    expect(validateCheckRequest({ ...valid, brief: { category: "CRM" } })).toMatchObject({ ok: false });
    expect(validateCheckRequest({ ...valid, brief: { product: "Acme" } })).toMatchObject({ ok: false });
    expect(validateCheckRequest({ ...valid, questions: [] })).toMatchObject({ ok: false });
    expect(validateCheckRequest(null)).toMatchObject({ ok: false });
  });

  it("keeps the check's web search switch, which defaults to on", () => {
    const off = validateCheckRequest({ ...valid, webSearch: false });
    expect(off.ok && off.value.webSearch).toBe(false);
    const unset = validateCheckRequest({ ...valid, webSearch: "nope" });
    expect(unset.ok && unset.value.webSearch).toBe(true);
  });

  it("allows up to 100 questions and ignores unknown models", () => {
    const questions = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, text: `Q${i}?` }));
    expect(validateCheckRequest({ ...valid, questions: questions(100) })).toMatchObject({ ok: true });
    expect(validateCheckRequest({ ...valid, questions: questions(101) })).toMatchObject({ ok: false, error: "Up to 100 questions per check." });
    const result = validateCheckRequest({ ...valid, models: ["claude", "grok"] });
    expect(result.ok && result.value.models).toEqual(["claude"]);
  });

  it("keeps the new intents and each question's topic", () => {
    const result = validateCheckRequest({
      ...valid,
      questions: [
        { id: "q1", text: "MetaMask vs Phantom?", intent: "comparison", topic: " trading " },
        { id: "q2", text: "Easiest wallet?", intent: "beginner" },
        { id: "q3", text: "Wallet for paying freelancers?", intent: "use-case", topic: 7 },
        { id: "q4", text: "Odd one?", intent: "made-up" },
      ],
    });
    expect(result.ok && result.value.questions).toEqual([
      { id: "q1", text: "MetaMask vs Phantom?", intent: "comparison", topic: "trading" },
      { id: "q2", text: "Easiest wallet?", intent: "beginner" },
      { id: "q3", text: "Wallet for paying freelancers?", intent: "use-case" },
      { id: "q4", text: "Odd one?", intent: "custom" },
    ]);
  });

  it("gives repeated question ids a unique one, since answers are matched by id", () => {
    const result = validateCheckRequest({
      ...valid,
      questions: [
        { id: "q1", text: "First?" },
        { id: "q1", text: "Second?" },
        { text: "Third?" },
      ],
    });
    const ids = result.ok ? result.value.questions.map((q) => q.id) : [];
    expect(ids[0]).toBe("q1");
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps up to five short research topics on the brief", () => {
    const result = validateCheckRequest({ ...valid, brief: { ...valid.brief, topics: [" trading ", "", 4, "RWA", "rwa", "AI", "x".repeat(60), "e", "f"] } });
    expect(result.ok && result.value.brief.topics).toEqual(["trading", "RWA", "AI", "x".repeat(40), "e"]);
    const none = validateCheckRequest(valid);
    expect(none.ok && none.value.brief.topics).toBeUndefined();
  });
});

describe("validateQuestionRequest", () => {
  it("reads the brief and a whole question count from 1 to 100", () => {
    const result = validateQuestionRequest({ brief: { ...valid.brief, topics: ["trading"] }, count: 50 });
    expect(result).toEqual({
      ok: true,
      value: { brief: { product: "Acme", category: "CRM", audience: "agencies", competitors: ["Close"], website: undefined, topics: ["trading"] }, count: 50 },
    });
  });

  it("reads the brand's other sites as clean domains, leaving out junk and leaving the field off when there are none", () => {
    const sites = validateQuestionRequest({ brief: { ...valid.brief, otherSites: ["https://www.acme.dev/docs", 7, "nope", "acme.dev"] }, count: 5 });
    expect(sites.ok && sites.value.brief.otherSites).toEqual(["acme.dev"]);
    const none = validateQuestionRequest({ brief: { ...valid.brief, otherSites: "acme.dev" }, count: 5 });
    expect(none.ok && "otherSites" in none.value.brief).toBe(false);
  });

  it("rejects a missing brief or a count outside 1 to 100", () => {
    expect(validateQuestionRequest({ brief: { category: "CRM" }, count: 10 })).toMatchObject({ ok: false });
    for (const count of [0, 101, 2.5, "10", undefined]) {
      expect(validateQuestionRequest({ brief: valid.brief, count })).toMatchObject({ ok: false, error: "Ask for between 1 and 100 questions." });
    }
    expect(validateQuestionRequest(null)).toMatchObject({ ok: false });
  });
});
