import type { Grade, SiteAudit } from "@/lib/audit/types";

export type BadgeTone = "meadow" | "sun" | "blush";

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const MAX_BADGES = 4;

const HEADLINES: Record<Grade, (site: string) => string> = {
  A: (site) => `AI crawlers can read ${site} easily`,
  B: (site) => `AI can read most of ${site}`,
  C: (site) => `AI can read parts of ${site}`,
  D: (site) => `AI struggles to read ${site}`,
  F: (site) => `AI can barely read ${site}`,
};

const uncheckedNote = (audit: SiteAudit) => audit.areas.find((a) => !a.checked)?.note;
const pagesRead = (audit: SiteAudit) => audit.pages.filter((p) => p.verdict === "readable" || p.verdict === "thin" || p.verdict === "blank").length;

export function auditHeadline(audit: SiteAudit): string {
  if (uncheckedNote(audit) !== undefined) return `Pip could only check who gets into ${audit.site}`;
  return HEADLINES[audit.grade](audit.site);
}

export function auditSubline(audit: SiteAudit): string {
  const note = uncheckedNote(audit);
  if (note !== undefined) return `${note.replace(/^Not checked:\s*/, "")}, so Pip graded crawler access only.`;
  return `${plural(pagesRead(audit), "page")} read the way AI crawlers see them: plain HTML, no JavaScript.`;
}

/** The few facts worth seeing at a glance, worst first. */
export function auditBadges(audit: SiteAudit): { label: string; tone: BadgeTone }[] {
  const checked = (area: string) => audit.areas.find((a) => a.area === area)?.checked ?? false;
  const live = audit.bots.filter((b) => b.role !== "training");
  const kept = live.filter((b) => b.access === "robots" || b.access === "firewall").length;
  const unsure = audit.bots.filter((b) => b.access === "unconfirmed").length;
  const partly = live.filter((b) => b.access === "partial").length;
  const blank = audit.pages.filter((p) => p.verdict === "blank").length;
  const thin = audit.pages.filter((p) => p.verdict === "thin").length;

  const badges: { label: string; tone: BadgeTone }[] = [];
  if (kept) badges.push({ label: `${plural(kept, "AI crawler")} kept out`, tone: "blush" });
  if (unsure) badges.push({ label: `${unsure} unconfirmed`, tone: "sun" });
  if (partly) badges.push({ label: `${partly} partly blocked`, tone: "sun" });
  if (!kept && !unsure && !partly) badges.push({ label: "Every AI search crawler gets in", tone: "meadow" });
  if (blank) badges.push({ label: `${plural(blank, "page")} blank without JavaScript`, tone: "blush" });
  if (thin) badges.push({ label: plural(thin, "thin page"), tone: "sun" });
  if (checked("structure") && !audit.organization) badges.push({ label: "No Organization data", tone: "sun" });
  if (checked("discovery")) badges.push(audit.llmsTxt.found ? { label: "llms.txt found", tone: "meadow" } : { label: "No llms.txt", tone: "sun" });

  const problems = badges.filter((b) => b.tone !== "meadow");
  return (problems.length ? problems : badges).slice(0, MAX_BADGES);
}

export function pipMood(audit: SiteAudit): "happy" | "thinking" | "idle" {
  if (audit.grade === "A" || audit.grade === "B") return "happy";
  return audit.grade === "F" ? "idle" : "thinking";
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function checkedAgo(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < 60_000) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}
