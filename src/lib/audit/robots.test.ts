import { describe, expect, it } from "vitest";
import { parseRobots, robotsFromResponse, robotsVerdict } from "@/lib/audit/robots";

const SAMPLE = `# Thimble's robots
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/help

Sitemap: https://thimble.studio/sitemap.xml
`;

describe("parseRobots", () => {
  it("groups consecutive user agents and collects sitemaps", () => {
    const robots = parseRobots(SAMPLE);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[0].agents).toEqual(["gptbot", "claudebot"]);
    expect(robots.groups[1].rules.map((r) => [r.allow, r.pattern])).toEqual([
      [false, "/admin"],
      [false, "/*.pdf$"],
      [true, "/admin/help"],
    ]);
    expect(robots.sitemaps).toEqual(["https://thimble.studio/sitemap.xml"]);
  });

  it("ignores comments, rules before any user agent, empty disallows and unknown keys", () => {
    const robots = parseRobots("Disallow: /early\nUser-agent: * # everyone\nDisallow:\nCrawl-delay: 5\nDisallow: /private # hush\n");
    expect(robots.groups).toHaveLength(1);
    expect(robots.groups[0].rules.map((r) => r.pattern)).toEqual(["/private"]);
  });

  it("starts a new group when a user agent follows rules", () => {
    const robots = parseRobots("User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y\n");
    expect(robots.groups.map((g) => g.agents)).toEqual([["a"], ["b"]]);
  });

  it("reads the product token from user agent lines and tolerates common typos", () => {
    const robots = parseRobots("useragent: Googlebot/2.1\ndissallow: /tmp\nUSER-AGENT: OAI-SearchBot\nDisallow: /\n");
    expect(robots.groups.map((g) => g.agents)).toEqual([["googlebot"], ["oai-searchbot"]]);
    expect(robots.groups[0].rules[0]).toMatchObject({ allow: false, pattern: "/tmp" });
  });

  it("handles CRLF line endings and a byte order mark", () => {
    const robots = parseRobots("\uFEFFUser-agent: *\r\nDisallow: /a\r\n");
    expect(robots.groups[0].rules[0].pattern).toBe("/a");
  });
});

describe("robotsVerdict", () => {
  const robots = parseRobots(SAMPLE);

  it("uses the group that names the bot over the catch-all", () => {
    expect(robotsVerdict(robots, "GPTBot", "/")).toMatchObject({ allowed: false, group: "named" });
    expect(robotsVerdict(robots, "OAI-SearchBot", "/")).toMatchObject({ allowed: true, group: "wildcard" });
  });

  it("matches tokens case-insensitively", () => {
    expect(robotsVerdict(robots, "claudebot", "/pricing").allowed).toBe(false);
  });

  it("picks the longest matching rule, with allow winning a tie", () => {
    expect(robotsVerdict(robots, "PerplexityBot", "/admin/users").allowed).toBe(false);
    expect(robotsVerdict(robots, "PerplexityBot", "/admin/help/faq").allowed).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page\n");
    expect(robotsVerdict(tie, "x", "/page").allowed).toBe(true);
  });

  it("supports * wildcards and $ end anchors", () => {
    expect(robotsVerdict(robots, "x", "/files/guide.pdf").allowed).toBe(false);
    expect(robotsVerdict(robots, "x", "/files/guide.pdf?v=2").allowed).toBe(true);
    const wild = parseRobots("User-agent: *\nDisallow: /*/drafts/\n");
    expect(robotsVerdict(wild, "x", "/blog/drafts/one").allowed).toBe(false);
    expect(robotsVerdict(wild, "x", "/drafts/one").allowed).toBe(true);
  });

  it("compares percent-encoded and plain paths alike", () => {
    const encoded = parseRobots("User-agent: *\nDisallow: /caf%C3%A9\n");
    expect(robotsVerdict(encoded, "x", "/café/menu").allowed).toBe(false);
  });

  it("merges every group that names the same bot", () => {
    const split = parseRobots("User-agent: GPTBot\nDisallow: /a\n\nUser-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /b\n");
    expect(robotsVerdict(split, "GPTBot", "/b/x").allowed).toBe(false);
    expect(robotsVerdict(split, "GPTBot", "/c").allowed).toBe(true);
  });

  it("allows everything when no group applies, and always allows /robots.txt", () => {
    const named = parseRobots("User-agent: GPTBot\nDisallow: /\n");
    expect(robotsVerdict(named, "ClaudeBot", "/")).toMatchObject({ allowed: true, group: "none" });
    expect(robotsVerdict(named, "GPTBot", "/robots.txt").allowed).toBe(true);
  });

  it("returns the rule and its line so the report can quote it", () => {
    const verdict = robotsVerdict(robots, "GPTBot", "/pricing");
    expect(verdict.rule).toMatchObject({ allow: false, pattern: "/", line: 4 });
  });
});

describe("robotsFromResponse", () => {
  it("parses a robots.txt that loads", () => {
    const state = robotsFromResponse(200, "User-agent: *\nDisallow: /x\n");
    expect(state.kind).toBe("found");
  });

  it("treats a missing file as no rules at all", () => {
    expect(robotsFromResponse(404, "Not found")).toMatchObject({ kind: "missing", status: 404 });
    expect(robotsFromResponse(403, "")).toMatchObject({ kind: "missing", status: 403 });
  });

  it("treats a web page served as robots.txt as missing", () => {
    expect(robotsFromResponse(200, "<!doctype html><html><body>Home</body></html>")).toMatchObject({ kind: "missing", status: 200, html: true });
  });

  it("treats server errors, rate limits and failed requests as stay-out-entirely", () => {
    expect(robotsFromResponse(503, "")).toMatchObject({ kind: "unreachable", status: 503 });
    expect(robotsFromResponse(429, "")).toMatchObject({ kind: "unreachable", status: 429 });
    expect(robotsFromResponse(null, null)).toMatchObject({ kind: "unreachable", status: null });
  });
});
