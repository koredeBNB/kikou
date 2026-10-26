import { describe, expect, it } from "vitest";
import { brandAliases, classifySentiment, findMentions } from "@/lib/sov/mentions";

describe("brandAliases", () => {
  it("keeps the full name and drops generic suffixes", () => {
    expect(brandAliases("HubSpot CRM")).toEqual(["HubSpot CRM", "HubSpot"]);
    expect(brandAliases("Acme Inc.")).toEqual(["Acme Inc.", "Acme"]);
    expect(brandAliases("Notion")).toEqual(["Notion"]);
  });

  it("drops a trailing category word when the category is given", () => {
    expect(brandAliases("Pipedrive Sales", "sales software")).toEqual(["Pipedrive Sales", "Pipedrive"]);
  });

  it("never reduces a brand to a too-short alias", () => {
    expect(brandAliases("Go App")).toEqual(["Go App"]);
  });
});

describe("findMentions", () => {
  const brands = ["Asana", "Trello", "Monday.com", "Notion"];

  it("ranks brands by order of first appearance", () => {
    const text = "1. **Trello** is simple.\n2. **Asana** scales well.\n3. Trello again.";
    const mentions = findMentions(text, brands);
    expect(mentions.map((m) => [m.brand, m.rank])).toEqual([
      ["Trello", 1],
      ["Asana", 2],
    ]);
  });

  it("matches case-insensitively and with possessives", () => {
    const mentions = findMentions("asana's timeline view is great. MONDAY.COM is colourful.", brands);
    expect(mentions.map((m) => m.brand)).toEqual(["Asana", "Monday.com"]);
  });

  it("does not match brands inside other words", () => {
    const mentions = findMentions("The notional value of a trellis is unclear.", brands);
    expect(mentions).toEqual([]);
  });

  it("prefers the longer brand when names overlap", () => {
    const mentions = findMentions("Zoho CRM is affordable, and Zoho Desk handles tickets.", ["Zoho", "Zoho CRM"]);
    expect(mentions.map((m) => m.brand)).toEqual(["Zoho CRM", "Zoho"]);
  });

  it("matches a brand through its alias", () => {
    const mentions = findMentions("Many teams pick HubSpot for its free tier.", ["HubSpot CRM"]);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].brand).toBe("HubSpot CRM");
    expect(mentions[0].offset).toBe(16);
  });

  it("captures the line around the mention as a snippet", () => {
    const text = "Intro line.\n- **Notion**: flexible docs and wikis, loved by startups.\n- Other";
    const [mention] = findMentions(text, brands);
    expect(mention.snippet).toBe("Notion: flexible docs and wikis, loved by startups.");
  });

  it("scores sentiment from the mention's snippet", () => {
    const text = "- Trello: excellent for simple boards.\n- Asana: expensive and has a steep learning curve.";
    const mentions = findMentions(text, brands);
    expect(mentions.find((m) => m.brand === "Trello")?.sentiment).toBe("positive");
    expect(mentions.find((m) => m.brand === "Asana")?.sentiment).toBe("negative");
  });
});

describe("classifySentiment", () => {
  it("labels clearly positive, negative and neutral text", () => {
    expect(classifySentiment("A great, intuitive choice that teams love.")).toBe("positive");
    expect(classifySentiment("Clunky interface and limited reporting.")).toBe("negative");
    expect(classifySentiment("It offers boards and lists.")).toBe("neutral");
  });

  it("flips a negated positive word", () => {
    expect(classifySentiment("Not the best option for large teams.")).toBe("negative");
  });
});
