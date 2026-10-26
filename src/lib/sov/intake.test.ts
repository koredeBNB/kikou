import { describe, expect, it } from "vitest";
import {
  isNonAnswer,
  parseCompetitors,
  parseIntro,
  readAudience,
  readCategory,
  readCompetitors,
  readPlanReply,
  readProduct,
  readWebsite,
} from "@/lib/sov/intake";

describe("parseIntro", () => {
  it("reads product, category and audience from one sentence", () => {
    expect(parseIntro("Acme, a CRM for small agencies")).toEqual({
      product: "Acme",
      category: "CRM",
      audience: "small agencies",
    });
    expect(parseIntro("Linear — project tracking for startups.")).toEqual({
      product: "Linear",
      category: "project tracking",
      audience: "startups",
    });
    expect(parseIntro("Notion is an all-in-one workspace for remote teams")).toEqual({
      product: "Notion",
      category: "all-in-one workspace",
      audience: "remote teams",
    });
  });

  it("handles a bare product name", () => {
    expect(parseIntro("  Acme  ")).toEqual({ product: "Acme" });
  });

  it("turns a domain into a product name plus website", () => {
    expect(parseIntro("acme-labs.io")).toEqual({ product: "Acme Labs", website: "acme-labs.io" });
  });

  it("keeps a category without an audience", () => {
    expect(parseIntro("Fernly: plant care app")).toEqual({ product: "Fernly", category: "plant care app" });
  });
});

describe("isNonAnswer", () => {
  it.each([
    "not sure",
    "Not sure!",
    "idk",
    "I don't know",
    "dunno",
    "no idea",
    "no clue",
    "find them for me",
    "you tell me",
    "can you find them?",
    "none",
    "nope",
    "n/a",
    "skip",
    "pass",
    "?",
    "not yet",
    "don't have one",
    "we don't have a website yet",
    "anyone",
    "not sure find them for me within the answer",
  ])("treats %j as a non-answer", (reply) => {
    expect(isNonAnswer(reply)).toBe(true);
  });

  it.each(["HubSpot", "Pipedrive, Close", "small agencies", "acme.com", "Notion", "Nobody Studio"])(
    "keeps %j as a real answer",
    (reply) => {
      expect(isNonAnswer(reply)).toBe(false);
    },
  );
});

describe("readCompetitors", () => {
  it("splits a list on commas, 'and' and new lines", () => {
    expect(readCompetitors("Pipedrive, Close and HubSpot\nCopper")).toEqual({
      kind: "ok",
      value: ["Pipedrive", "Close", "HubSpot", "Copper"],
      ignored: [],
    });
    expect(readCompetitors("asana & monday.com")).toEqual({ kind: "ok", value: ["asana", "monday.com"], ignored: [] });
  });

  it("treats uncertainty and requests to find them as a skip", () => {
    expect(readCompetitors("not sure find them for me within the answer")).toEqual({ kind: "skip" });
    expect(readCompetitors("idk")).toEqual({ kind: "skip" });
    expect(readCompetitors("you tell me")).toEqual({ kind: "skip" });
    expect(readCompetitors("none")).toEqual({ kind: "skip" });
    expect(readCompetitors("Skip")).toEqual({ kind: "skip" });
  });

  it("strips lead-ins so the names inside a sentence survive", () => {
    expect(readCompetitors("I think it's mostly Planta and Greg")).toEqual({ kind: "ok", value: ["Planta", "Greg"], ignored: [] });
    expect(readCompetitors("We compete with Asana, Trello")).toEqual({ kind: "ok", value: ["Asana", "Trello"], ignored: [] });
  });

  it("keeps the names and drops the chatter around them", () => {
    expect(readCompetitors("Planta, not sure about the rest")).toEqual({
      kind: "ok",
      value: ["Planta"],
      ignored: ["not sure about the rest"],
    });
  });

  it("calls a sentence with no brand names unclear instead of echoing it", () => {
    expect(readCompetitors("we usually lose deals to bigger tools")).toEqual({ kind: "unclear" });
  });

  it("accepts title-cased brand names that contain common words", () => {
    expect(readCompetitors("You Need A Budget, Mint")).toEqual({ kind: "ok", value: ["You Need A Budget", "Mint"], ignored: [] });
  });

  it("keeps parseCompetitors as a names-only shortcut", () => {
    expect(parseCompetitors("Pipedrive, Close")).toEqual(["Pipedrive", "Close"]);
    expect(parseCompetitors("not sure find them for me within the answer")).toEqual([]);
  });
});

describe("readProduct", () => {
  it("reads the usual intro", () => {
    expect(readProduct("Acme, a CRM for small agencies")).toEqual({
      kind: "ok",
      value: { product: "Acme", category: "CRM", audience: "small agencies" },
    });
  });

  it("strips 'my product is' and 'it's called' lead-ins", () => {
    expect(readProduct("My product is Acme, a CRM for small agencies")).toEqual({
      kind: "ok",
      value: { product: "Acme", category: "CRM", audience: "small agencies" },
    });
    expect(readProduct("It's called Fernly")).toEqual({ kind: "ok", value: { product: "Fernly" } });
  });

  it("reads every example on the home page in one go", () => {
    expect(readProduct("Fernly, a plant care app for new plant parents")).toEqual({
      kind: "ok",
      value: { product: "Fernly", category: "plant care app", audience: "new plant parents" },
    });
    expect(readProduct("Thimble — project tracker for small design studios")).toEqual({
      kind: "ok",
      value: { product: "Thimble", category: "project tracker", audience: "small design studios" },
    });
  });

  it("skips non-answers and greetings", () => {
    expect(readProduct("not sure")).toEqual({ kind: "skip" });
    expect(readProduct("hi")).toEqual({ kind: "skip" });
  });

  it("calls a sentence unclear rather than naming the product after it", () => {
    expect(readProduct("i want to see if chatgpt recommends my app")).toEqual({ kind: "unclear" });
  });
});

describe("readCategory", () => {
  it("reads a short category, with an optional audience", () => {
    expect(readCategory("CRM")).toEqual({ kind: "ok", value: { category: "CRM" } });
    expect(readCategory("a plant care app for new plant parents.")).toEqual({
      kind: "ok",
      value: { category: "plant care app", audience: "new plant parents" },
    });
    expect(readCategory("We make a CRM")).toEqual({ kind: "ok", value: { category: "CRM" } });
    expect(readCategory("It's an AI writing assistant")).toEqual({ kind: "ok", value: { category: "AI writing assistant" } });
  });

  it("skips non-answers", () => {
    expect(readCategory("not sure")).toEqual({ kind: "skip" });
    expect(readCategory("idk")).toEqual({ kind: "skip" });
  });

  it("calls a description unclear", () => {
    expect(readCategory("it helps people remember to water their plants")).toEqual({ kind: "unclear" });
  });
});

describe("readAudience", () => {
  it("reads an audience and strips 'for'", () => {
    expect(readAudience("small agencies")).toEqual({ kind: "ok", value: "small agencies" });
    expect(readAudience("It's for freelancers.")).toEqual({ kind: "ok", value: "freelancers" });
    expect(readAudience("people who own a lot of houseplants")).toEqual({ kind: "ok", value: "people who own a lot of houseplants" });
  });

  it("skips non-answers", () => {
    expect(readAudience("not sure")).toEqual({ kind: "skip" });
    expect(readAudience("anyone")).toEqual({ kind: "skip" });
    expect(readAudience("everyone really")).toEqual({ kind: "skip" });
    expect(readAudience("honestly I'm not really sure who buys it")).toEqual({ kind: "skip" });
  });

  it("calls a long ramble unclear", () => {
    expect(
      readAudience("well it depends because some of our customers are big and some are small and they all use it differently"),
    ).toEqual({ kind: "unclear" });
  });
});

describe("readWebsite", () => {
  it("reads a domain, even inside a sentence", () => {
    expect(readWebsite("acme.com")).toEqual({ kind: "ok", value: "acme.com" });
    expect(readWebsite("https://www.acme.com/")).toEqual({ kind: "ok", value: "acme.com" });
    expect(readWebsite("it's fernly.app")).toEqual({ kind: "ok", value: "fernly.app" });
  });

  it.each(["don't have one", "not yet", "we don't have a website yet", "none", "n/a", "skip", "coming soon", "no site"])(
    "skips %j",
    (reply) => {
      expect(readWebsite(reply)).toEqual({ kind: "skip" });
    },
  );

  it("calls a reply without a domain unclear", () => {
    expect(readWebsite("our site is being rebuilt")).toEqual({ kind: "unclear" });
  });
});

describe("readPlanReply", () => {
  it.each(["let's go", "Start", "go!", "looks good", "yes", "run it", "ok"])("starts the check on %j", (reply) => {
    expect(readPlanReply(reply)).toEqual({ kind: "start" });
  });

  it("adds a real question", () => {
    expect(readPlanReply("Which CRM integrates best with Gmail?")).toEqual({
      kind: "ok",
      value: "Which CRM integrates best with Gmail?",
    });
    expect(readPlanReply("best crm with a free plan")).toEqual({ kind: "ok", value: "best crm with a free plan?" });
  });

  it("skips non-answers and calls fragments unclear", () => {
    expect(readPlanReply("not sure")).toEqual({ kind: "skip" });
    expect(readPlanReply("gmail")).toEqual({ kind: "unclear" });
  });
});
