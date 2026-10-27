import { describe, expect, it } from "vitest";
import type { Finding, SiteAudit } from "@/lib/audit/types";
import { withReadability } from "@/lib/sov/recommendations";
import type { Recommendation, RecommendationPriority } from "@/lib/sov/types";

const rec = (id: string, priority: RecommendationPriority): Recommendation => ({ id, title: id, detail: `${id} detail`, priority, area: "visibility" });
const finding = (id: string, severity: Finding["severity"], impact: number): Finding => ({ id, area: "access", severity, impact, title: `Fix ${id}`, detail: `Why ${id}` });
const audit = (findings: Finding[]) => ({ findings }) as SiteAudit;

describe("withReadability", () => {
  it("adds the two worst findings: failures to do first, big warnings next", () => {
    const merged = withReadability([rec("a", "high"), rec("b", "medium"), rec("monitor", "low")], audit([finding("firewall", "fail", 7), finding("llms-txt", "warn", 5), finding("blank-pages", "fail", 4)]));
    expect(merged.map((r) => [r.id, r.priority])).toEqual([
      ["a", "high"],
      ["readability-firewall", "high"],
      ["b", "medium"],
      ["readability-llms-txt", "medium"],
      ["monitor", "low"],
    ]);
    expect(merged[1]).toEqual({ id: "readability-firewall", title: "Fix firewall", detail: "Why firewall", priority: "high", area: "readability" });
  });

  it("leaves out small warnings", () => {
    const recs = [rec("a", "high")];
    expect(withReadability(recs, audit([finding("canonical", "warn", 3)]))).toEqual(recs);
  });

  it("keeps to six, and the worst finding always gets a place", () => {
    const recs = ["a", "b", "c", "d", "e", "f"].map((id) => rec(id, "high"));
    const merged = withReadability(recs, audit([finding("robots-blocked", "fail", 14), finding("firewall", "fail", 7)]));
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "readability-robots-blocked"]);
  });

  it("leaves the list alone without an audit", () => {
    const recs = [rec("a", "high")];
    expect(withReadability(recs, undefined)).toBe(recs);
  });
});
