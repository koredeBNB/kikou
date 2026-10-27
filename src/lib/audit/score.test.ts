import { describe, expect, it } from "vitest";
import { robotsFromResponse } from "@/lib/audit/robots";
import {
  evaluateBots,
  gradeFor,
  llmsTxtSnippet,
  organizationSnippet,
  pageVerdict,
  robotsSnippet,
  scoreAudit,
  type AuditFacts,
} from "@/lib/audit/score";
import type { PageAudit } from "@/lib/audit/types";

const page = (path: string, overrides: Partial<PageAudit> = {}): PageAudit => ({
  url: `https://thimble.studio${path}`,
  verdict: "readable",
  status: 200,
  words: 800,
  title: `Thimble ${path}`,
  hasDescription: true,
  h1Count: 1,
  canonical: true,
  noindex: false,
  nosnippet: false,
  schemaTypes: [],
  invalidJsonLd: 0,
  cited: 0,
  ...overrides,
});

const open = { status: 200, challenge: false };
const allOpen = Object.fromEntries(
  ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User", "ClaudeBot", "Googlebot", "PerplexityBot", "Perplexity-User"].map((t) => [t, open]),
);

const facts = (overrides: Partial<AuditFacts> = {}): AuditFacts => ({
  site: "thimble.studio",
  homepage: "https://thimble.studio/",
  brand: "Thimble",
  category: "project tracker",
  audience: "small design studios",
  robots: robotsFromResponse(200, "User-agent: *\nDisallow: /admin\nSitemap: https://thimble.studio/sitemap.xml\n"),
  probes: allOpen,
  pages: [page("/", { schemaTypes: ["Organization", "WebSite"] }), page("/pricing", { schemaTypes: ["Product"] }), page("/faq", { schemaTypes: ["FAQPage"] })],
  organization: { name: "Thimble", url: "https://thimble.studio", logo: true, sameAs: 3 },
  llmsTxt: { found: true, wellFormed: true, title: "Thimble", links: 6, full: false },
  sitemap: { found: true, listed: true, url: "https://thimble.studio/sitemap.xml", pages: 40 },
  ...overrides,
});

const meta = { checkedAt: "2026-10-27T12:00:00.000Z", elapsedMs: 9_000 };

describe("pageVerdict", () => {
  it("calls pages readable, thin or blank by the words a crawler sees", () => {
    expect(pageVerdict(600)).toBe("readable");
    expect(pageVerdict(120)).toBe("thin");
    expect(pageVerdict(30)).toBe("blank");
    expect(pageVerdict(140, "An empty #root element")).toBe("blank");
  });
});

describe("gradeFor", () => {
  it("maps scores to grades", () => {
    expect([95, 90, 80, 75, 64, 60, 47, 40, 12].map(gradeFor)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "F"]);
  });
});

describe("evaluateBots", () => {
  it("separates robots.txt blocks, firewall refusals and partial blocks", () => {
    const robots = robotsFromResponse(200, "User-agent: GPTBot\nDisallow: /\n\nUser-agent: Claude-SearchBot\nDisallow: /pricing\n");
    const bots = evaluateBots(robots, { ...allOpen, PerplexityBot: { status: 403, challenge: false } }, ["/", "/pricing", "/faq"]);
    const by = Object.fromEntries(bots.map((b) => [b.token, b]));
    expect(by.GPTBot).toMatchObject({ access: "robots", points: 0, rule: { text: "Disallow: /", line: 2, named: true } });
    expect(by.PerplexityBot).toMatchObject({ access: "firewall", points: 0, probe: { status: 403 } });
    expect(by["Claude-SearchBot"]).toMatchObject({ access: "partial", blockedPaths: ["/pricing"] });
    expect(by["Claude-SearchBot"].points).toBeCloseTo((7 * 2) / 3, 5);
    expect(by["OAI-SearchBot"]).toMatchObject({ access: "allowed", points: 7 });
    expect(by["Google-Extended"]).toMatchObject({ access: "allowed", probe: undefined });
  });

  it("counts a bot check page as a refusal", () => {
    const bots = evaluateBots(robotsFromResponse(404, ""), { ...allOpen, "OAI-SearchBot": { status: 200, challenge: true } }, ["/"]);
    expect(bots.find((b) => b.token === "OAI-SearchBot")?.access).toBe("firewall");
  });

  it("gives the benefit of the doubt when a probe got no answer", () => {
    const bots = evaluateBots(robotsFromResponse(404, ""), { ...allOpen, Googlebot: { status: null, challenge: false } }, ["/"]);
    expect(bots.find((b) => b.token === "Googlebot")?.access).toBe("allowed");
  });

  it("can't confirm a refusal when Kioku's own crawler was refused too, and counts it half", () => {
    const bots = evaluateBots(robotsFromResponse(404, ""), { ...allOpen, PerplexityBot: { status: 403, challenge: true } }, ["/"], true);
    expect(bots.find((b) => b.token === "PerplexityBot")).toMatchObject({ access: "unconfirmed", points: 3.5 });
    expect(bots.find((b) => b.token === "OAI-SearchBot")?.access).toBe("allowed");
  });

  it("keeps every bot out when robots.txt errors", () => {
    const bots = evaluateBots(robotsFromResponse(503, ""), allOpen, ["/"]);
    expect(bots.every((b) => b.access === "robots" && b.points === 0)).toBe(true);
  });
});

describe("scoreAudit", () => {
  it("gives a well-built site an A with nothing urgent", () => {
    const audit = scoreAudit(facts(), meta);
    expect(audit.score).toBe(100);
    expect(audit.grade).toBe("A");
    expect(audit.areas.map((a) => [a.area, a.points, a.max])).toEqual([
      ["access", 35, 35],
      ["rendering", 30, 30],
      ["structure", 20, 20],
      ["discovery", 15, 15],
    ]);
    expect(audit.findings.filter((f) => f.severity === "fail")).toEqual([]);
    expect(audit.areas[0].note).toBe("Every AI crawler gets in");
  });

  it("ranks a firewall block on a search crawler above a missing llms.txt", () => {
    const audit = scoreAudit(
      facts({ probes: { ...allOpen, PerplexityBot: { status: 403, challenge: false } }, llmsTxt: { found: false, wellFormed: false, links: 0, full: false } }),
      meta,
    );
    expect(audit.findings[0]).toMatchObject({ id: "firewall", severity: "fail", area: "access" });
    expect(audit.findings[0].title).toBe("Let PerplexityBot past your firewall");
    expect(audit.findings[0].detail).toContain("403");
    expect(audit.findings.at(-1)?.id).toBe("llms-txt");
    expect(audit.areas[0]).toMatchObject({ points: 28, note: "1 of 10 AI bots kept out" });
  });

  it("asks the site to check its bot protection when refusals can't be confirmed", () => {
    const refused = { status: 403, challenge: true };
    const audit = scoreAudit(facts({ crawlersRefused: true, probes: { ...allOpen, "OAI-SearchBot": refused, PerplexityBot: refused } }), meta);
    const finding = audit.findings.find((f) => f.id === "bot-protection");
    expect(finding).toMatchObject({ severity: "warn", impact: 7, title: "Check that OAI-SearchBot and PerplexityBot get past your bot protection" });
    expect(finding?.detail).toContain("Kioku's own crawler");
    expect(audit.findings.find((f) => f.id === "firewall")).toBeUndefined();
    expect(audit.areas[0]).toMatchObject({ points: 28, note: "No AI bots kept out for sure, 2 unconfirmed" });
  });

  it("treats blocking training crawlers as a fair choice, not a fault", () => {
    const robots = robotsFromResponse(200, "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nSitemap: https://thimble.studio/sitemap.xml\n");
    const audit = scoreAudit(facts({ robots }), meta);
    expect(audit.areas[0].points).toBe(34);
    expect(audit.findings.find((f) => f.area === "access")).toBeUndefined();
  });

  it("offers robots.txt lines when search crawlers are blocked", () => {
    const robots = robotsFromResponse(200, "User-agent: *\nDisallow: /\n");
    const audit = scoreAudit(facts({ robots, sitemap: { found: true, listed: false, url: "https://thimble.studio/sitemap.xml", pages: 40 } }), meta);
    const finding = audit.findings.find((f) => f.id === "robots-blocked");
    expect(finding?.severity).toBe("fail");
    expect(finding?.snippet?.text).toContain("User-agent: OAI-SearchBot");
    expect(finding?.snippet?.text).toContain("Allow: /");
    expect(finding?.snippet?.text).not.toContain("GPTBot");
    expect(audit.areas[0].points).toBe(0);
  });

  it("puts a robots.txt that errors first", () => {
    const audit = scoreAudit(facts({ robots: robotsFromResponse(503, "") }), meta);
    expect(audit.findings[0]).toMatchObject({ id: "robots-unreachable", severity: "fail" });
    expect(audit.areas[0].note).toMatch(/didn't load/);
  });

  it("scores pages blank without JavaScript, with the homepage counting double", () => {
    const pages = [
      page("/", { words: 12, verdict: "blank", appShell: "An empty #root element that JavaScript fills in" }),
      page("/pricing"),
      page("/faq"),
    ];
    const audit = scoreAudit(facts({ pages }), meta);
    const rendering = audit.areas.find((a) => a.area === "rendering")!;
    expect(rendering.points).toBe(18);
    expect(rendering.note).toBe("1 of 3 pages blank without JavaScript");
    const finding = audit.findings.find((f) => f.id === "blank-pages");
    expect(finding).toMatchObject({ severity: "fail", title: "Serve your homepage's content without JavaScript" });
    expect(finding?.detail).toContain("12 words on your homepage (an empty #root element that JavaScript fills in)");
  });

  it("leaves skipped and failed pages out of the rendering score", () => {
    const pages = [page("/"), page("/docs", { verdict: "skipped", words: 0, note: "robots.txt asks crawlers to stay out" }), page("/old", { verdict: "failed", status: 404, words: 0 })];
    const audit = scoreAudit(facts({ pages }), meta);
    expect(audit.areas.find((a) => a.area === "rendering")?.points).toBe(30);
  });

  it("grades crawler access alone when Pip couldn't read any page, without guessing at the rest", () => {
    const robots = robotsFromResponse(200, "User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nUser-agent: Claude-SearchBot\nUser-agent: Googlebot\nUser-agent: PerplexityBot\nAllow: /\n");
    const skipped = { verdict: "skipped" as const, words: 0, note: "robots.txt asks crawlers to stay out" };
    const audit = scoreAudit(
      facts({ robots, pages: [page("/", skipped)], organization: null, sitemap: { found: false, listed: false, pages: 0 }, llmsTxt: { found: false, wellFormed: false, links: 0, full: false } }),
      meta,
    );
    expect(audit.areas.slice(1).map((a) => [a.points, a.checked, a.note])).toEqual([
      [0, false, "Not checked: robots.txt keeps Kioku out"],
      [0, false, "Not checked: robots.txt keeps Kioku out"],
      [0, false, "Not checked: robots.txt keeps Kioku out"],
    ]);
    expect(audit.score).toBe(Math.round((100 * audit.areas[0].points) / 35));
    expect(audit.findings.map((f) => f.area)).toEqual(["access"]);
  });

  it("says when the site turned Kioku's crawler away", () => {
    const audit = scoreAudit(facts({ crawlersRefused: true, pages: [page("/", { verdict: "failed", status: 403, words: 0, note: "Answered 403" })] }), meta);
    expect(audit.areas[1].note).toBe("Not checked: the site turned Kioku's crawler away");
  });

  it("flags noindex on the homepage", () => {
    const audit = scoreAudit(facts({ pages: [page("/", { noindex: true }), page("/pricing")] }), meta);
    expect(audit.findings[0]).toMatchObject({ id: "noindex", severity: "fail" });
    expect(audit.areas[0].points).toBe(25);
  });

  it("offers Organization JSON-LD filled in from the brief when it's missing", () => {
    const audit = scoreAudit(facts({ organization: null, pages: [page("/"), page("/pricing")] }), meta);
    const finding = audit.findings.find((f) => f.id === "organization");
    expect(finding?.snippet?.text).toContain('"name": "Thimble"');
    expect(audit.areas.find((a) => a.area === "structure")).toMatchObject({ points: 0, note: "No structured data found" });
  });

  it("notices an Organization whose name doesn't match the brand", () => {
    const audit = scoreAudit(facts({ organization: { name: "Acme Holdings", url: "https://thimble.studio", logo: true, sameAs: 2 } }), meta);
    expect(audit.organization?.matchesBrand).toBe(false);
    expect(audit.findings.find((f) => f.id === "organization-details")?.detail).toContain("Acme Holdings");
  });

  it("scores discovery files, with llms.txt worth little", () => {
    const audit = scoreAudit(
      facts({ llmsTxt: { found: false, wellFormed: false, links: 0, full: false }, sitemap: { found: false, listed: false, pages: 0 } }),
      meta,
    );
    const discovery = audit.areas.find((a) => a.area === "discovery")!;
    expect(discovery).toMatchObject({ points: 3, note: "No sitemap · no llms.txt" });
    expect(audit.findings.find((f) => f.id === "sitemap")?.impact).toBeGreaterThan(audit.findings.find((f) => f.id === "llms-txt")!.impact);
  });

  it("returns the facts it was given alongside the score", () => {
    const audit = scoreAudit(facts(), meta);
    expect(audit).toMatchObject({ version: 1, site: "thimble.studio", homepage: "https://thimble.studio/", checkedAt: meta.checkedAt, elapsedMs: 9_000, robots: { state: "found", status: 200 } });
    expect(audit.bots).toHaveLength(10);
  });
});

describe("snippets", () => {
  it("writes robots.txt lines that let the named crawlers in", () => {
    expect(robotsSnippet(["OAI-SearchBot", "PerplexityBot"])).toBe("User-agent: OAI-SearchBot\nUser-agent: PerplexityBot\nAllow: /");
  });

  it("writes Organization JSON-LD from the brief", () => {
    const text = organizationSnippet({ brand: "Thimble", category: "project tracker", audience: "small design studios", homepage: "https://www.thimble.studio/" });
    const json = JSON.parse(text.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    expect(json).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Thimble",
      url: "https://www.thimble.studio/",
      description: "Project tracker for small design studios.",
    });
  });

  it("writes a starter llms.txt from the readable pages", () => {
    const text = llmsTxtSnippet({ brand: "Thimble", category: "project tracker", audience: "small design studios" }, [
      page("/", { title: "Thimble – project tracker" }),
      page("/pricing", { title: "Pricing" }),
      page("/docs/getting-started", { title: undefined }),
      page("/broken", { verdict: "blank" }),
    ]);
    expect(text).toBe(
      "# Thimble\n\n> Project tracker for small design studios.\n\n## Key pages\n\n- [Home](https://thimble.studio/): Thimble – project tracker\n- [Pricing](https://thimble.studio/pricing): Pricing\n- [Getting started](https://thimble.studio/docs/getting-started)",
    );
  });
});
