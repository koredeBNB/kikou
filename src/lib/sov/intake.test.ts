import { describe, expect, it } from "vitest";
import { parseCompetitors, parseIntro } from "@/lib/sov/intake";

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

describe("parseCompetitors", () => {
  it("splits on commas, 'and' and new lines", () => {
    expect(parseCompetitors("Pipedrive, Close and HubSpot\nCopper")).toEqual(["Pipedrive", "Close", "HubSpot", "Copper"]);
  });

  it("treats skip words as no competitors", () => {
    expect(parseCompetitors("skip")).toEqual([]);
    expect(parseCompetitors("none")).toEqual([]);
    expect(parseCompetitors("not sure")).toEqual([]);
  });
});
