import { describe, expect, it } from "vitest";
import { collectCitations, domainOf, extractUrls } from "@/lib/sov/citations";

describe("extractUrls", () => {
  it("finds markdown links and bare URLs", () => {
    const text =
      "See [G2's ranking](https://www.g2.com/categories/crm) and https://reddit.com/r/sales/comments/abc for opinions.";
    expect(extractUrls(text)).toEqual([
      "https://www.g2.com/categories/crm",
      "https://reddit.com/r/sales/comments/abc",
    ]);
  });

  it("strips trailing punctuation and closing brackets", () => {
    const text = "Sources: (https://example.com/a), https://example.org/b. And https://example.net/c!";
    expect(extractUrls(text)).toEqual(["https://example.com/a", "https://example.org/b", "https://example.net/c"]);
  });

  it("keeps balanced parentheses inside a URL", () => {
    expect(extractUrls("Read https://en.wikipedia.org/wiki/Asana_(software) today")).toEqual([
      "https://en.wikipedia.org/wiki/Asana_(software)",
    ]);
  });

  it("reads numbered reference lists", () => {
    const text = "Answer text [1][2].\n\n[1]: https://capterra.com/crm\n[2] https://zapier.com/blog/best-crm/";
    expect(extractUrls(text)).toEqual(["https://capterra.com/crm", "https://zapier.com/blog/best-crm/"]);
  });

  it("dedupes repeated URLs", () => {
    expect(extractUrls("https://a.com/x https://a.com/x")).toEqual(["https://a.com/x"]);
  });

  it("ignores non-http schemes", () => {
    expect(extractUrls("ftp://files.example.com and mailto:hi@example.com")).toEqual([]);
  });
});

describe("domainOf", () => {
  it("lowercases and strips www", () => {
    expect(domainOf("https://WWW.G2.com/categories")).toBe("g2.com");
  });

  it("keeps meaningful subdomains", () => {
    expect(domainOf("https://blog.hubspot.com/sales")).toBe("blog.hubspot.com");
  });

  it("returns null for invalid input", () => {
    expect(domainOf("not a url")).toBeNull();
  });
});

describe("collectCitations", () => {
  it("merges provider citations with URLs in the text, provider first, without duplicates", () => {
    const result = collectCitations("More at https://www.capterra.com/crm-software/.", [
      "https://www.g2.com/categories/crm",
      "https://www.capterra.com/crm-software/",
    ]);
    expect(result).toEqual([
      { url: "https://www.g2.com/categories/crm", domain: "g2.com" },
      { url: "https://www.capterra.com/crm-software/", domain: "capterra.com" },
    ]);
  });

  it("drops provider entries that are not valid URLs", () => {
    expect(collectCitations("", ["", "garbage"])).toEqual([]);
  });
});
