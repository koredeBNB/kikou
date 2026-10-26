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

  it("pulls research topics out of the first message", () => {
    expect(rulesTurn("product", "research BNB's standing within trading, RWA, AI")).toEqual({
      intent: "answer",
      values: { product: "BNB", topics: ["trading", "RWA", "AI"] },
    });
    expect(rulesTurn("product", "Acme, a CRM for small agencies, focusing on pipeline management and reporting")).toEqual({
      intent: "answer",
      values: { product: "Acme", category: "CRM", audience: "small agencies", topics: ["pipeline management", "reporting"] },
    });
  });

  it("reads focus areas at their own step", () => {
    expect(rulesTurn("topics", "security, staking and DeFi")).toEqual({ intent: "answer", values: { topics: ["security", "staking", "DeFi"] } });
    expect(rulesTurn("topics", "not sure")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("topics", "Broad check")).toEqual({ intent: "skip", values: {} });
  });

  it("reads how many questions to ask, capping at 100", () => {
    expect(rulesTurn("count", "about 50")).toEqual({ intent: "answer", values: { count: 50 } });
    expect(rulesTurn("count", "max")).toEqual({ intent: "answer", values: { count: 100 } });
    expect(rulesTurn("count", "300 please")).toEqual({ intent: "answer", values: { count: 100 }, capped: true });
    expect(rulesTurn("count", "you pick")).toEqual({ intent: "skip", values: {} });
    expect(rulesTurn("count", "some")).toEqual({ intent: "unclear", values: {} });
  });

  it("flags a partial competitor list", () => {
    expect(rulesTurn("competitors", "Planta, not sure about the rest")).toEqual({
      intent: "answer",
      values: { competitors: ["Planta"] },
      partial: true,
    });
    expect(rulesTurn("competitors", "Planta, Greg")).toEqual({ intent: "answer", values: { competitors: ["Planta", "Greg"] } });
  });

  it("pulls a website out of an all-in-one reply instead of mixing it into other fields", () => {
    expect(rulesTurn("product", "It's Fernly, a plant care app for new plant parents, site's fernly.app")).toEqual({
      intent: "answer",
      values: { product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" },
    });
    expect(rulesTurn("product", "Fernly (fernly.app), a plant care app")).toEqual({
      intent: "answer",
      values: { product: "Fernly", category: "plant care app", website: "fernly.app" },
    });
    expect(rulesTurn("category", "a plant care app for new plant parents. Our website is https://www.fernly.app/")).toEqual({
      intent: "answer",
      values: { category: "plant care app", audience: "new plant parents", website: "fernly.app" },
    });
    expect(rulesTurn("audience", "new plant parents, and our site is fernly.app")).toEqual({
      intent: "answer",
      values: { audience: "new plant parents", website: "fernly.app" },
    });
  });

  it("takes an inline competitor decline out of an all-in-one reply", () => {
    const values = { product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" };
    expect(rulesTurn("product", "It's Fernly, a plant care app for new plant parents, site's fernly.app. Competitors? Honestly not sure")).toEqual({
      intent: "answer",
      values,
      skips: ["competitors"],
    });
    expect(rulesTurn("product", "It's Fernly, a plant care app for new plant parents, site's fernly.app. Not sure about competitors yet")).toEqual({
      intent: "answer",
      values,
      skips: ["competitors"],
    });
  });

  it("reads a bare decline after the competitor word, mid-reply", () => {
    expect(rulesTurn("product", "Acme, a CRM for small agencies, competitors? not sure, site is acme.io")).toEqual({
      intent: "answer",
      values: { product: "Acme", category: "CRM", audience: "small agencies", website: "acme.io" },
      skips: ["competitors"],
    });
    expect(rulesTurn("product", "Acme, a CRM for small agencies. Competitors: no idea").skips).toEqual(["competitors"]);
  });

  it("doesn't read a competitor list as a decline", () => {
    expect(rulesTurn("product", "Acme, a CRM for small agencies. Competitors are HubSpot and Pipedrive").skips).toBeUndefined();
    expect(rulesTurn("product", "Acme, the CRM that beats competitors, for small agencies").skips).toBeUndefined();
  });

  it("leaves dotted product names and tech terms alone", () => {
    expect(rulesTurn("product", "monday.com, a work OS for teams")).toEqual({
      intent: "answer",
      values: { product: "monday.com", category: "work OS", audience: "teams" },
    });
    expect(rulesTurn("product", "Acme, a Node.js library for developers")).toEqual({
      intent: "answer",
      values: { product: "Acme", category: "Node.js library", audience: "developers" },
    });
  });

  it("reads a website", () => {
    expect(rulesTurn("website", "it's fernly.app")).toEqual({ intent: "answer", values: { website: "fernly.app" } });
  });
});
