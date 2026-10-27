import { describe, expect, it } from "vitest";
import { auditBadges, auditHeadline, auditSubline, checkedAgo, pipMood } from "@/lib/audit/summary";
import type { AreaScore, BotResult, Grade, PageAudit, SiteAudit } from "@/lib/audit/types";

const area = (name: AreaScore["area"], checked = true, note = ""): AreaScore => ({ area: name, points: 0, max: 10, note, checked });
const bot = (token: string, role: BotResult["role"], access: BotResult["access"]) => ({ token, role, access }) as BotResult;
const page = (verdict: PageAudit["verdict"]) => ({ url: "https://thimble.studio/x", verdict }) as PageAudit;

function audit(overrides: Partial<SiteAudit> = {}): SiteAudit {
  return {
    site: "thimble.studio",
    grade: "B",
    areas: [area("access"), area("rendering"), area("structure"), area("discovery")],
    bots: [bot("OAI-SearchBot", "search", "allowed"), bot("GPTBot", "training", "robots")],
    pages: [page("readable"), page("readable")],
    organization: { name: "Thimble", logo: true, sameAs: 1, matchesBrand: true },
    llmsTxt: { found: true, wellFormed: true, links: 4, full: false },
    ...overrides,
  } as SiteAudit;
}

describe("auditHeadline", () => {
  it.each<[Grade, string]>([
    ["A", "AI crawlers can read thimble.studio easily"],
    ["B", "AI can read most of thimble.studio"],
    ["C", "AI can read parts of thimble.studio"],
    ["D", "AI struggles to read thimble.studio"],
    ["F", "AI can barely read thimble.studio"],
  ])("says what a %s means", (grade, headline) => {
    expect(auditHeadline(audit({ grade }))).toBe(headline);
  });

  it("says when only crawler access could be checked", () => {
    const blocked = audit({ areas: [area("access"), area("rendering", false, "Not checked: robots.txt keeps Kioku out")] });
    expect(auditHeadline(blocked)).toBe("Pip could only check who gets into thimble.studio");
    expect(auditSubline(blocked)).toBe("robots.txt keeps Kioku out, so Pip graded crawler access only.");
  });
});

describe("auditSubline", () => {
  it("counts the pages read", () => {
    expect(auditSubline(audit({ pages: [page("readable"), page("blank"), page("skipped"), page("failed")] }))).toBe(
      "2 pages read the way AI crawlers see them: plain HTML, no JavaScript.",
    );
    expect(auditSubline(audit({ pages: [page("thin")] }))).toBe("1 page read the way AI crawlers see them: plain HTML, no JavaScript.");
  });
});

describe("auditBadges", () => {
  it("leads with crawlers kept out, then blank pages and missing files", () => {
    const badges = auditBadges(
      audit({
        bots: [bot("PerplexityBot", "search", "firewall"), bot("Claude-User", "user", "robots"), bot("GPTBot", "training", "robots"), bot("ClaudeBot", "training", "unconfirmed")],
        pages: [page("readable"), page("blank"), page("blank"), page("thin")],
        organization: null,
        llmsTxt: { found: false, wellFormed: false, links: 0, full: false },
      }),
    );
    expect(badges).toEqual([
      { label: "2 AI crawlers kept out", tone: "blush" },
      { label: "1 unconfirmed", tone: "sun" },
      { label: "2 pages blank without JavaScript", tone: "blush" },
      { label: "1 thin page", tone: "sun" },
    ]);
  });

  it("names missing structured data and llms.txt when there's room", () => {
    expect(auditBadges(audit({ organization: null, llmsTxt: { found: false, wellFormed: false, links: 0, full: false } }))).toEqual([
      { label: "No Organization data", tone: "sun" },
      { label: "No llms.txt", tone: "sun" },
    ]);
  });

  it("says what's going well when nothing is wrong", () => {
    expect(auditBadges(audit())).toEqual([
      { label: "Every AI search crawler gets in", tone: "meadow" },
      { label: "llms.txt found", tone: "meadow" },
    ]);
  });

  it("doesn't mention files it couldn't check", () => {
    const blocked = audit({ areas: [area("access"), area("rendering", false), area("structure", false), area("discovery", false)], organization: null, pages: [page("skipped")] });
    expect(auditBadges(blocked)).toEqual([{ label: "Every AI search crawler gets in", tone: "meadow" }]);
  });
});

describe("pipMood", () => {
  it("cheers good grades and thinks about the rest", () => {
    expect(pipMood(audit({ grade: "A" }))).toBe("happy");
    expect(pipMood(audit({ grade: "B" }))).toBe("happy");
    expect(pipMood(audit({ grade: "C" }))).toBe("thinking");
    expect(pipMood(audit({ grade: "F" }))).toBe("idle");
  });
});

describe("checkedAgo", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it.each([
    ["2026-10-27T11:59:30Z", "just now"],
    ["2026-10-27T11:55:00Z", "5 minutes ago"],
    ["2026-10-27T10:00:00Z", "2 hours ago"],
    ["2026-10-26T09:00:00Z", "yesterday"],
    ["2026-10-20T12:00:00Z", "7 days ago"],
  ])("puts %s as %s", (iso, label) => {
    expect(checkedAgo(iso, now)).toBe(label);
  });
});
