import { describe, expect, it } from "vitest";
import {
  acceptDraft,
  acceptedLine,
  applyTurn,
  DEFAULT_QUESTION_COUNT,
  draftIntake,
  draftLine,
  emptyIntake,
  nextField,
  questionCount,
  questionFor,
  settleSites,
  SITES_COPY,
  toBrief,
} from "@/lib/intake/flow";
import type { IntakeState, OptionalField } from "@/lib/intake/types";

const withState = (patch: Partial<IntakeState>): IntakeState => ({ ...emptyIntake(), ...patch });
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);
const brief = { product: "Fernly", category: "plant care app", audience: "new plant parents", competitors: ["Planta"], website: "fernly.app" };

describe("nextField", () => {
  it("walks product, category, audience, competitors, website, topics and count, then review", () => {
    expect(nextField(emptyIntake())).toBe("product");
    expect(nextField(withState({ product: "Fernly" }))).toBe("category");
    expect(nextField(withState({ product: "Fernly", category: "plant care app" }))).toBe("audience");
    expect(nextField(withState({ product: "Fernly", category: "app", audience: "new plant parents" }))).toBe("competitors");
    expect(nextField(withState({ product: "Fernly", category: "app", audience: "a", competitors: ["Planta"] }))).toBe("website");
    expect(nextField(withState(brief))).toBe("topics");
    expect(nextField(withState({ ...brief, topics: ["watering"] }))).toBe("count");
    expect(nextField(withState({ ...brief, topics: ["watering"], count: 25 }))).toBe("review");
  });

  it("treats skipped fields as done", () => {
    expect(nextField(withState({ product: "Fernly", category: "app", skipped: ["audience", "competitors"] }))).toBe("website");
    expect(nextField(withState({ ...brief, skipped: ["topics", "count"] }))).toBe("review");
  });
});

describe("topics and question count", () => {
  it("confirms research topics from the first message, then asks what the product is", () => {
    const result = applyTurn(emptyIntake(), "product", { intent: "answer", values: { product: "BNB", topics: ["trading", "RWA", "AI"] } });
    expect(result.state.topics).toEqual(["trading", "RWA", "AI"]);
    expect(result.next).toBe("category");
    expect(texts(result.messages)).toEqual([
      "Lovely to meet **BNB**! I'll focus on trading, RWA and AI. What kind of product is it? A short category works best, like “CRM” or “plant care app”.",
    ]);
  });

  it("asks for focus areas after the website, with examples that suit the category", () => {
    const state = withState({ product: "Trust Wallet", category: "crypto wallet", audience: "", competitors: [], skipped: ["audience", "competitors"] });
    const result = applyTurn(state, "website", { intent: "answer", values: { website: "trustwallet.com" } });
    expect(result.next).toBe("topics");
    const ask = questionFor("topics", result.state);
    expect(texts(result.messages).at(-1)).toBe(ask);
    expect(ask).toMatch(/security/);
    expect(ask).toMatch(/skip for a broad check/);
    expect(questionFor("topics", withState({ category: "CRM" }))).not.toMatch(/staking/);
  });

  it("runs a broad check when topics are skipped, then asks how many questions", () => {
    const result = applyTurn(withState(brief), "topics", { intent: "skip", values: {} });
    expect(result.state.skipped).toContain("topics");
    expect(result.next).toBe("count");
    expect(texts(result.messages)).toEqual(["No problem, I'll run a broad check across the whole category.", questionFor("count", result.state)]);
  });

  it("says how it will split the questions across the topics", () => {
    const result = applyTurn(withState(brief), "topics", { intent: "answer", values: { topics: ["watering", "pest control"] } });
    expect(texts(result.messages)).toEqual([
      "Got it. I'll split the questions evenly across watering and pest control.",
      questionFor("count", result.state),
    ]);
  });

  it("asks how many questions last", () => {
    expect(questionFor("count", withState(brief))).toBe(
      "Last one: how many questions should I ask each AI? Pick 10, 25, 50 or 100, or any number up to 100.",
    );
    expect(questionFor("website", withState(brief))).not.toMatch(/^Last one/);
  });

  it("takes the count and moves on to the plan", () => {
    const state = withState({ ...brief, skipped: ["topics"] });
    const result = applyTurn(state, "count", { intent: "answer", values: { count: 50 } });
    expect(result.state.count).toBe(50);
    expect(result.next).toBe("review");
    expect(texts(result.messages)).toEqual(["Got it, 50 questions for each assistant."]);
    expect(texts(applyTurn(state, "count", { intent: "answer", values: { count: 1 } }).messages)).toEqual(["Got it, 1 question for each assistant."]);
  });

  it("says when it capped a big number", () => {
    const result = applyTurn(withState({ ...brief, skipped: ["topics"] }), "count", { intent: "answer", values: { count: 100 }, capped: true });
    expect(texts(result.messages)).toEqual(["100 is the most I can ask in one check, so I'll ask 100."]);
  });

  it("uses 10 questions when the count is skipped or stays unclear", () => {
    const state = withState({ ...brief, skipped: ["topics"] });
    const skipped = applyTurn(state, "count", { intent: "skip", values: {} });
    expect(skipped.next).toBe("review");
    expect(questionCount(skipped.state)).toBe(DEFAULT_QUESTION_COUNT);
    expect(DEFAULT_QUESTION_COUNT).toBe(10);
    expect(texts(skipped.messages)).toEqual(["No problem, I'll ask 10 questions."]);

    const once = applyTurn(state, "count", { intent: "unclear", values: {} });
    expect(once.next).toBe("count");
    const twice = applyTurn(once.state, "count", { intent: "unclear", values: {} });
    expect(twice.next).toBe("review");
    expect(texts(twice.messages)).toEqual(["I couldn't spot a number there, so I'll ask 10 questions."]);
  });

  it("puts the topics on the brief", () => {
    expect(toBrief(withState({ ...brief, topics: ["watering"] })).topics).toEqual(["watering"]);
    expect(toBrief(withState(brief)).topics).toBeUndefined();
  });
});

describe("applyTurn", () => {
  it("fills several fields from one reply and skips the steps already answered", () => {
    const result = applyTurn(emptyIntake(), "product", {
      intent: "answer",
      values: { product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" },
    });
    expect(result.state).toMatchObject({
      product: "Fernly",
      category: "plant care app",
      audience: "new plant parents",
      website: "fernly.app",
    });
    expect(result.next).toBe("competitors");
    expect(texts(result.messages)).toEqual([
      "Lovely: **Fernly**, a plant care app for new plant parents.",
      questionFor("competitors", result.state),
    ]);
  });

  it("goes straight to review once nothing is missing", () => {
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app", topics: ["watering"], count: 10 });
    const result = applyTurn(state, "competitors", { intent: "answer", values: { competitors: ["Planta", "Greg"] } });
    expect(result.next).toBe("review");
    expect(texts(result.messages)).toEqual(["Noted. I'll watch Planta and Greg."]);
  });

  it("doesn't overwrite an earlier answer from a later reply", () => {
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents" });
    const result = applyTurn(state, "competitors", {
      intent: "answer",
      values: { competitors: ["Planta"], audience: "everyone", website: "fernly.app" },
    });
    expect(result.state.audience).toBe("new plant parents");
    expect(result.state.website).toBe("fernly.app");
    expect(result.state.competitors).toEqual(["Planta"]);
  });

  it("treats an answer that doesn't cover the asked field as unclear", () => {
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents" });
    const result = applyTurn(state, "competitors", { intent: "answer", values: { website: "fernly.app" } });
    expect(result.next).toBe("competitors");
    expect(result.state.website).toBe("fernly.app");
    expect(result.state.nudged).toEqual(["competitors"]);
  });

  it("re-asks a required field when it's skipped", () => {
    const result = applyTurn(emptyIntake(), "product", { intent: "skip", values: {} });
    expect(result.next).toBe("product");
    expect(texts(result.messages)).toEqual(["Let's start with the name. What's your product called? A working name is fine."]);

    const category = applyTurn(withState({ product: "Fernly" }), "category", { intent: "skip", values: {} });
    expect(category.next).toBe("category");
    expect(category.messages[0].text).toMatch(/^No worries\. Think of what a buyer would type/);
  });

  it("marks an optional field skipped and says what happens instead", () => {
    const state = withState({ product: "Thimble", category: "project tracker", audience: "small design studios" });
    const result = applyTurn(state, "competitors", { intent: "skip", values: {} });
    expect(result.state.skipped).toEqual(["competitors"]);
    expect(result.state.competitors).toEqual([]);
    expect(result.next).toBe("website");
    expect(texts(result.messages)).toEqual([
      "No problem, I'll spot your competitors in the answers.",
      questionFor("website", result.state),
    ]);
  });

  it("asks once for a clearer optional answer, then moves on", () => {
    const state = withState({ product: "Thimble", category: "project tracker", audience: "small design studios" });
    const first = applyTurn(state, "competitors", { intent: "unclear", values: {} });
    expect(first.next).toBe("competitors");
    expect(first.messages[0].text).toMatch(/^I couldn't pick out any brand names there/);

    const second = applyTurn(first.state, "competitors", { intent: "unclear", values: {} });
    expect(second.next).toBe("website");
    expect(second.state.skipped).toContain("competitors");
    expect(second.messages[0].text).toBe("I still couldn't pick out any brand names, so I'll spot your competitors in the answers instead.");
  });

  it("keeps asking for a required field that's unclear", () => {
    const state = withState({ product: "Fernly" });
    const once = applyTurn(state, "category", { intent: "unclear", values: {} });
    const twice = applyTurn(once.state, "category", { intent: "unclear", values: {} });
    expect(twice.next).toBe("category");
    expect(twice.messages[0].text).toMatch(/^Could you say that in a few words/);
  });

  it("uses the model's message when it asks for the right next field", () => {
    const result = applyTurn(emptyIntake(), "product", {
      intent: "answer",
      values: { product: "Fernly" },
      asks: "category",
      message: "Hi **Fernly**! What kind of product is it, like “plant care app”?",
    });
    expect(result.messages).toEqual([{ text: "Hi **Fernly**! What kind of product is it, like “plant care app”?", mood: "wave" }]);
  });

  it("falls back to its own wording when the model asks for the wrong field", () => {
    const result = applyTurn(emptyIntake(), "product", {
      intent: "answer",
      values: { product: "Fernly", category: "plant care app" },
      asks: "category",
      message: "What kind of product is Fernly?",
    });
    expect(result.next).toBe("audience");
    expect(texts(result.messages)).toEqual([
      "**Fernly**, a plant care app. Lovely! Who is it for? Describe your typical buyer, or skip if it's for everyone.",
    ]);
  });

  it("records an optional field the reply declines alongside its other answers", () => {
    const result = applyTurn(emptyIntake(), "product", {
      intent: "answer",
      values: { product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" },
      skips: ["competitors"],
    });
    expect(result.state.skipped).toEqual(["competitors"]);
    expect(result.next).toBe("topics");
    expect(texts(result.messages)).toEqual([
      "Lovely: **Fernly**, a plant care app for new plant parents.",
      "No problem, I'll spot your competitors in the answers.",
      questionFor("topics", result.state),
    ]);
  });

  it("ignores declines for required or already answered fields", () => {
    const state = withState({ product: "Fernly", category: "plant care app", competitors: ["Planta"] });
    const result = applyTurn(state, "audience", {
      intent: "answer",
      values: { audience: "new plant parents" },
      skips: ["product", "category", "competitors"] as OptionalField[],
    });
    expect(result.state.skipped).toEqual([]);
    expect(result.state.competitors).toEqual(["Planta"]);
    expect(result.next).toBe("website");
  });

  it("mentions the rest of a partial competitor list", () => {
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app", skipped: ["topics", "count"] });
    const result = applyTurn(state, "competitors", { intent: "answer", values: { competitors: ["Planta"] }, partial: true });
    expect(texts(result.messages)).toEqual(["Noted. I'll watch Planta and spot any others in the answers."]);
  });
});

describe("toBrief", () => {
  it("turns intake state into a brief, with skipped fields left empty", () => {
    const state = withState({ product: "Fernly", category: "plant care app", skipped: ["audience", "competitors", "website"] });
    expect(toBrief(state)).toEqual({ product: "Fernly", category: "plant care app", audience: "", competitors: [], website: undefined });
  });
});

describe("drafted briefs", () => {
  const drafted = { product: "BNB Chain", category: "layer 1 blockchain", audience: "", competitors: ["Ethereum"], topics: ["RWA", "AI"] };

  it("fills the intake from the draft, then asks only for the website and count once it's confirmed", () => {
    const state = draftIntake(drafted);
    expect(state).toMatchObject({ product: "BNB Chain", category: "layer 1 blockchain", competitors: ["Ethereum"], topics: ["RWA", "AI"], skipped: [] });
    const accepted = acceptDraft(state);
    expect(accepted.next).toBe("website");
    expect(accepted.state.skipped).toEqual(["audience"]);
    expect(acceptedLine(accepted.state, accepted.next)).toBe(`Great, nearly there. ${questionFor("website", accepted.state)}`);
    expect(questionFor("website", accepted.state)).toMatch(/cite you/);

    const answered = applyTurn(accepted.state, "website", { intent: "answer", values: { website: "bnbchain.org" } });
    expect(answered.next).toBe("count");
    expect(answered.state.website).toBe("bnbchain.org");
    expect(applyTurn(accepted.state, "website", { intent: "skip", values: {} }).next).toBe("count");
  });

  it("still asks about the website when the draft has one, naming every site it'll count", () => {
    const accepted = acceptDraft(draftIntake({ ...drafted, website: "bnbchain.org" }));
    expect(accepted.next).toBe("website");
    expect(accepted.state.skipped).toEqual(["audience"]);
    expect(acceptedLine(accepted.state, accepted.next)).toBe(
      "Great, nearly there. I'll count citations of **bnbchain.org** as yours, subdomains included. Got any other sites, like a separate docs or blog domain? List them, fix that one if it's wrong, or say “that's all”.",
    );
    const two = acceptDraft(draftIntake({ ...drafted, website: "bnbchain.org", otherSites: ["bnb.org"] }));
    expect(questionFor("website", two.state)).toMatch(/^I'll count citations of \*\*bnbchain\.org\*\* and \*\*bnb\.org\*\* as yours.*fix these if/);
  });

  it("still asks about the website when the user already said how many questions", () => {
    const accepted = acceptDraft(draftIntake(drafted, 25));
    expect(accepted.next).toBe("website");
    expect(applyTurn(accepted.state, "website", { intent: "skip", values: {} }).next).toBe("review");
  });

  it("introduces the draft by what the brand is, or by what the user said when Pip didn't know it", () => {
    expect(draftLine({ ...drafted, description: "the Layer 1 blockchain behind BNB" }, { known: true })).toMatch(/^Do you mean \*\*BNB Chain\*\*, the Layer 1 blockchain behind BNB\?/);
    expect(draftLine(drafted, { known: true, web: true })).toMatch(/^I looked it up\. Is it \*\*BNB Chain\*\*, a layer 1 blockchain\?/);
    expect(draftLine(drafted, { known: false })).toMatch(/^I don't know \*\*BNB Chain\*\* yet, so I went by what you said\./);
  });

  it("reads several sites from one answer to the website question", () => {
    const turn = { intent: "answer" as const, values: { website: "fernly.app", otherSites: ["fernly.dev", "docs.fernly.app"] } };
    const answered = applyTurn(withState({ product: "Fernly", category: "app", audience: "a", competitors: ["Planta"] }), "website", turn);
    expect(answered.state).toMatchObject({ website: "fernly.app", otherSites: ["fernly.dev"] });
    expect(toBrief(answered.state)).toMatchObject({ website: "fernly.app", otherSites: ["fernly.dev"] });
    const skipped = applyTurn(answered.state, "website", { intent: "skip", values: {} });
    expect(skipped.state.website).toBeUndefined();
    expect(skipped.state.otherSites).toBeUndefined();
  });
});

describe("settleSites", () => {
  const drafted = { product: "BNB Chain", category: "layer 1 blockchain", audience: "", competitors: ["Ethereum"], topics: ["RWA", "AI"], website: "bnbchain.org" };
  const accepted = (count?: number) => acceptDraft(draftIntake(drafted, count)).state;

  it("keeps the drafted sites and asks for the count", () => {
    const settled = settleSites(accepted(), "keep");
    expect(settled.state.website).toBe("bnbchain.org");
    expect(settled.next).toBe("count");
    expect(settled.text).toBe(`${SITES_COPY.kept} ${questionFor("count", settled.state)}`);
  });

  it("records new sites, main one first, and says which it'll count", () => {
    const settled = settleSites(accepted(25), ["bnbchain.org", "bnb.org", "docs.bnbchain.org"]);
    expect(toBrief(settled.state)).toMatchObject({ website: "bnbchain.org", otherSites: ["bnb.org"] });
    expect(settled.next).toBe("review");
    expect(settled.text).toBe("Got it: I'll count citations of **bnbchain.org** and **bnb.org** as yours.");
  });

  it("skips the website when there are no sites left", () => {
    const settled = settleSites(accepted(), []);
    expect(settled.state.website).toBeUndefined();
    expect(settled.state.skipped).toContain("website");
    expect(settled.next).toBe("count");
    expect(settled.text).toMatch(/^No problem, we'll go without it\. Last one/);
  });
});
