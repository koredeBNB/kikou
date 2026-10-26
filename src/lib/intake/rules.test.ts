import { describe, expect, it } from "vitest";
import { rulesTurn } from "@/lib/intake/rules";

describe("rulesTurn", () => {
  it("reads a full intro at the product step", () => {
    expect(rulesTurn("product", "Acme, a CRM for small agencies")).toEqual({
      intent: "answer",
      values: { product: "Acme", category: "CRM", audience: "small agencies" },
    });
  });

  it("skips or flags vague replies at every step", () => {
    expect(rulesTurn("product", "hi")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("product", "i want to see if chatgpt recommends my app")).toEqual({ intent: "unclear", values: {} });
    expect(rulesTurn("category", "not sure")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("audience", "anyone")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("competitors", "not sure find them for me within the answer")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("website", "we don't have a website yet")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("website", "our site is being rebuilt")).toEqual({ intent: "unclear", values: {} });
  });

  it("carries an audience given alongside the category", () => {
    expect(rulesTurn("category", "a plant care app for new plant parents.")).toEqual({
      intent: "answer",
      values: { category: "plant care app", audience: "new plant parents" },
    });
  });

  it("flags a partial competitor list", () => {
    expect(rulesTurn("competitors", "Planta, not sure about the rest")).toEqual({
      intent: "answer",
      values: { competitors: ["Planta"] },
      partial: true,
    });
    expect(rulesTurn("competitors", "Planta, Greg")).toEqual({ intent: "answer", values: { competitors: ["Planta", "Greg"] } });
  });

  it("reads a website", () => {
    expect(rulesTurn("website", "it's fernly.app")).toEqual({ intent: "answer", values: { website: "fernly.app" } });
  });
});
