import { describe, expect, it } from "vitest";
import { pageKey, pickPages } from "@/lib/audit/pages";

const ORIGIN = "https://www.thimble.studio";

describe("pageKey", () => {
  it("ignores www, trailing slashes, fragments, queries and case", () => {
    expect(pageKey("https://www.thimble.studio/Pricing/?a=1#x")).toBe("thimble.studio/pricing");
    expect(pageKey("https://thimble.studio")).toBe("thimble.studio/");
  });

  it("treats index files as their folder", () => {
    expect(pageKey("https://thimble.studio/index.html")).toBe("thimble.studio/");
    expect(pageKey("https://thimble.studio/docs/index.php")).toBe("thimble.studio/docs");
  });
});

describe("pickPages", () => {
  it("starts with the homepage, then the pages assistants cited, most cited first", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [
        { url: "https://thimble.studio/blog/rituals", count: 2 },
        { url: "https://thimble.studio/docs/start?utm=x", count: 5 },
      ],
      candidates: [],
    });
    expect(picks.map((p) => [p.url, p.cited])).toEqual([
      ["https://www.thimble.studio/", 0],
      ["https://thimble.studio/docs/start", 5],
      ["https://thimble.studio/blog/rituals", 2],
    ]);
  });

  it("fills up with answer-shaped pages before others, shallow ones first", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [],
      candidates: [
        `${ORIGIN}/team/offsite-2024/photos`,
        `${ORIGIN}/about`,
        `${ORIGIN}/compare/quiltboard`,
        `${ORIGIN}/pricing`,
        `${ORIGIN}/features/timeline`,
        `${ORIGIN}/random`,
      ],
      max: 5,
    });
    expect(picks.map((p) => new URL(p.url).pathname)).toEqual(["/", "/pricing", "/compare/quiltboard", "/features/timeline", "/about"]);
  });

  it("leaves out logins, legal pages, other sites, translations and duplicates", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [{ url: "https://quiltboard.com/pricing", count: 9 }],
      candidates: [
        `${ORIGIN}/login`,
        `${ORIGIN}/privacy`,
        `${ORIGIN}/fr/pricing`,
        `${ORIGIN}/pricing`,
        `${ORIGIN}/pricing/`,
        "https://docs.thimble.studio/start",
        `${ORIGIN}/en/features`,
      ],
    });
    expect(picks.map((p) => new URL(p.url).pathname)).toEqual(["/", "/pricing", "/en/features"]);
  });

  it("takes at most three pages from one section", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [],
      candidates: ["a", "b", "c", "d", "e"].map((slug) => `${ORIGIN}/blog/${slug}`),
    });
    expect(picks.filter((p) => p.url.includes("/blog/"))).toHaveLength(3);
  });

  it("counts sections after a language prefix, so /en/ sites aren't one big section", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [],
      candidates: [`${ORIGIN}/en/pricing`, `${ORIGIN}/en/features`, `${ORIGIN}/en/compare/a`, `${ORIGIN}/en/docs/start`, `${ORIGIN}/en/about`],
    });
    expect(picks).toHaveLength(6);
  });

  it("stops at the page limit", () => {
    const picks = pickPages({
      origin: ORIGIN,
      site: "thimble.studio",
      cited: [],
      candidates: Array.from({ length: 40 }, (_, i) => `${ORIGIN}/section-${i}/page`),
      max: 12,
    });
    expect(picks).toHaveLength(12);
  });
});
