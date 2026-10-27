import { describe, expect, it } from "vitest";
import { buildDemoAudit } from "@/lib/audit/demo";

const cited = [
  { url: "https://thimble.studio/blog/best-for", count: 6 },
  { url: "https://thimble.studio/blog/alternatives", count: 3 },
  { url: "https://thimble.studio/blog/budget", count: 1 },
];
const now = new Date("2026-10-27T12:00:00Z");

describe("buildDemoAudit", () => {
  it("grades the fictional Thimble site with the real scorer", () => {
    const audit = buildDemoAudit(cited, now);
    expect(audit).toMatchObject({ version: 1, site: "thimble.studio", homepage: "https://thimble.studio/", checkedAt: now.toISOString(), grade: "C" });
    const access = Object.fromEntries(audit.bots.map((b) => [b.token, b.access]));
    expect(access).toMatchObject({ GPTBot: "robots", ClaudeBot: "robots", PerplexityBot: "firewall", "OAI-SearchBot": "allowed", Googlebot: "allowed" });
    expect(audit.findings[0].id).toBe("firewall");
    expect(audit.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["blank-pages", "llms-txt"]));
  });

  it("marks the pages the sample answers cited, most cited first", () => {
    const pages = buildDemoAudit(cited, now).pages;
    expect(pages[0].url).toBe("https://thimble.studio/");
    expect(pages.filter((p) => p.cited > 0).map((p) => [new URL(p.url).pathname, p.cited])).toEqual([
      ["/blog/best-for", 6],
      ["/blog/alternatives", 3],
    ]);
  });

  it("is the same every time", () => {
    expect(buildDemoAudit(cited, now)).toEqual(buildDemoAudit(cited, now));
    expect(buildDemoAudit([], now).pages.length).toBeGreaterThan(4);
  });
});
