import type { BotRole } from "@/lib/audit/bots";
import type { OrganizationNode } from "@/lib/audit/html";
import type { ModelId } from "@/lib/sov/types";

export type Grade = "A" | "B" | "C" | "D" | "F";
export type AuditArea = "access" | "rendering" | "structure" | "discovery";

/**
 * `partial`: robots.txt lets it onto the homepage but keeps it off some sampled pages. `unconfirmed`: refused,
 * but so was Kioku's own crawler, so it may be general bot protection that lets the real crawler through.
 */
export type BotAccess = "allowed" | "partial" | "robots" | "firewall" | "unconfirmed";

export interface Probe {
  /** Status after redirects, or null when the request got no answer. */
  status: number | null;
  /** The answer was a bot check ("Just a moment…") rather than the page. */
  challenge: boolean;
}

export interface BotResult {
  token: string;
  model: ModelId;
  role: BotRole;
  roleLabel: string;
  access: BotAccess;
  weight: number;
  points: number;
  /** The robots.txt rule that keeps it off the homepage. `named`: the rule is in a group that names this bot. */
  rule?: { text: string; line: number; named: boolean };
  /** The homepage request sent with this bot's name. Absent for robots.txt-only tokens. */
  probe?: Probe;
  /** Sampled pages robots.txt keeps it away from. */
  blockedPaths: string[];
  note: string;
}

export type PageVerdict = "readable" | "thin" | "blank" | "skipped" | "failed";

export interface PageAudit {
  url: string;
  verdict: PageVerdict;
  status?: number;
  /** Visible words in the raw HTML, the way a crawler that doesn't run JavaScript reads it. */
  words: number;
  title?: string;
  hasDescription: boolean;
  h1Count: number;
  canonical: boolean;
  noindex: boolean;
  nosnippet: boolean;
  appShell?: string;
  schemaTypes: string[];
  invalidJsonLd: number;
  /** Times the check's answers cited this page. */
  cited: number;
  /** Why it was skipped or couldn't be read. */
  note?: string;
}

export interface AreaScore {
  area: AuditArea;
  points: number;
  max: number;
  note: string;
  /** False when Pip couldn't read any page, so the area wasn't graded. */
  checked: boolean;
}

export interface Finding {
  id: string;
  area: AuditArea;
  severity: "fail" | "warn";
  /** Roughly the points it costs; fixes are listed by this. */
  impact: number;
  title: string;
  detail: string;
  snippet?: { label: string; text: string };
}

export interface LlmsTxtFacts {
  found: boolean;
  wellFormed: boolean;
  title?: string;
  links: number;
  /** /llms-full.txt exists too. */
  full: boolean;
}

export interface SitemapFacts {
  found: boolean;
  /** robots.txt points to it. */
  listed: boolean;
  url?: string;
  pages: number;
}

export interface SiteAudit {
  version: 1;
  /** The brand's domain, e.g. "thimble.studio". */
  site: string;
  /** Where the homepage ended up after redirects. */
  homepage: string;
  checkedAt: string;
  elapsedMs: number;
  score: number;
  grade: Grade;
  areas: AreaScore[];
  robots: { state: "found" | "missing" | "unreachable"; status: number | null };
  bots: BotResult[];
  pages: PageAudit[];
  organization: (OrganizationNode & { matchesBrand: boolean }) | null;
  llmsTxt: LlmsTxtFacts;
  sitemap: SitemapFacts;
  findings: Finding[];
}

export type AuditStep = "home" | "robots" | "bots" | "files" | "pages" | "score";

export type AuditEvent =
  | { type: "step"; step: AuditStep; message: string }
  | { type: "page"; url: string; done: number; total: number }
  | { type: "done"; audit: SiteAudit }
  | { type: "error"; message: string };
