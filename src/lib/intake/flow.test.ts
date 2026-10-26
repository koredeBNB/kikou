import { describe, expect, it } from "vitest";
import { applyTurn, emptyIntake, nextField, questionFor, toBrief } from "@/lib/intake/flow";
import type { IntakeState, OptionalField } from "@/lib/intake/types";

const withState = (patch: Partial<IntakeState>): IntakeState => ({ ...emptyIntake(), ...patch });
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe("nextField", () => {
  it("walks product, category, audience, competitors, website, then review", () => {
    expect(nextField(emptyIntake())).toBe("product");
    expect(nextField(withState({ product: "Fernly" }))).toBe("category");
    expect(nextField(withState({ product: "Fernly", category: "plant care app" }))).toBe("audience");
    expect(nextField(withState({ product: "Fernly", category: "app", audience: "new plant parents" }))).toBe("competitors");
    expect(nextField(withState({ product: "Fernly", category: "app", audience: "a", competitors: ["Planta"] }))).toBe("website");
    expect(nextField(withState({ product: "Fernly", category: "app", audience: "a", competitors: ["Planta"], website: "fernly.app" }))).toBe(
      "review",
    );
  });

  it("treats skipped fields as done", () => {
    expect(nextField(withState({ product: "Fernly", category: "app", skipped: ["audience", "competitors"] }))).toBe("website");
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
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" });
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
    expect(result.next).toBe("review");
    expect(texts(result.messages)).toEqual([
      "Lovely: **Fernly**, a plant care app for new plant parents.",
      "No problem, I'll spot your competitors in the answers.",
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
    const state = withState({ product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" });
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
