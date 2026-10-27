import { AI_BOTS, CRAWLER_POINTS } from "@/lib/audit/bots";
import type { OrganizationNode } from "@/lib/audit/html";
import { verdictFor, type RobotsState } from "@/lib/audit/robots";
import type {
  AreaScore,
  BotResult,
  Finding,
  Grade,
  LlmsTxtFacts,
  PageAudit,
  PageVerdict,
  Probe,
  SiteAudit,
  SitemapFacts,
} from "@/lib/audit/types";
import { listJoin } from "@/lib/format";
import { MODEL_LABELS } from "@/lib/sov/types";

/** Everything the audit found, before it's scored. */
export interface AuditFacts {
  site: string;
  homepage: string;
  brand: string;
  category: string;
  audience?: string;
  robots: RobotsState;
  /** Homepage requests sent with each bot's name, by token. */
  probes: Record<string, Probe>;
  pages: PageAudit[];
  organization: OrganizationNode | null;
  llmsTxt: LlmsTxtFacts;
  sitemap: SitemapFacts;
  /** The homepage refused Kioku's own crawler too, so refusals of the AI bots' names can't be pinned on them. */
  crawlersRefused?: boolean;
}

export const RENDERING_POINTS = 30;
export const STRUCTURE_POINTS = 20;
export const DISCOVERY_POINTS = 15;
const NOINDEX_HOME_PENALTY = 10;
const NOINDEX_PAGES_PENALTY = 5;
const READABLE_WORDS = 150;
const BLANK_WORDS = 50;
const CONTENT_TYPES = new Set([
  "Product",
  "SoftwareApplication",
  "WebApplication",
  "MobileApplication",
  "Service",
  "FAQPage",
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "HowTo",
  "BreadcrumbList",
  "Course",
  "Event",
  "Review",
  "AggregateRating",
  "ItemList",
  "VideoObject",
]);
const MAX_PATHS_NAMED = 3;
const MAX_LLMS_LINKS = 8;

export function pageVerdict(words: number, appShell?: string): Exclude<PageVerdict, "skipped" | "failed"> {
  if (words < BLANK_WORDS || (appShell && words < READABLE_WORDS)) return "blank";
  return words < READABLE_WORDS ? "thin" : "readable";
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const sentence = (text: string) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);
const isRead = (p: PageAudit) => p.verdict === "readable" || p.verdict === "thin" || p.verdict === "blank";
const isHome = (p: PageAudit) => new URL(p.url).pathname === "/";

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function namePaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_PATHS_NAMED);
  const more = paths.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${plural(more, "more page")}` : listJoin(shown);
}

function refused(probe: Probe | undefined): boolean {
  if (!probe || probe.status === null) return false;
  return probe.challenge || probe.status < 200 || probe.status >= 300;
}

export function evaluateBots(robots: RobotsState, probes: Record<string, Probe>, paths: string[], crawlersRefused = false): BotResult[] {
  const sample = paths.length ? paths : ["/"];
  return AI_BOTS.map((bot) => {
    const home = verdictFor(robots, bot.token, "/");
    const blockedPaths = sample.filter((path) => !verdictFor(robots, bot.token, path).allowed);
    const probe = bot.userAgent ? probes[bot.token] : undefined;
    const rule = home.rule && !home.allowed ? { text: `${home.rule.allow ? "Allow" : "Disallow"}: ${home.rule.pattern}`, line: home.rule.line, named: home.group === "named" } : undefined;
    const base = { token: bot.token, model: bot.model, role: bot.role, roleLabel: bot.roleLabel, weight: bot.weight, probe, blockedPaths, note: bot.note, rule };
    if (!home.allowed) return { ...base, access: "robots", points: 0 };
    if (refused(probe)) return crawlersRefused ? { ...base, access: "unconfirmed", points: bot.weight / 2 } : { ...base, access: "firewall", points: 0 };
    if (blockedPaths.length > 0) return { ...base, access: "partial", points: bot.weight * (1 - blockedPaths.length / sample.length) };
    return { ...base, access: "allowed", points: bot.weight };
  });
}

export function robotsSnippet(tokens: string[]): string {
  return [...tokens.map((t) => `User-agent: ${t}`), "Allow: /"].join("\n");
}

function describe(category: string, audience?: string): string {
  return `${sentence(category.trim())}${audience?.trim() ? ` for ${audience.trim()}` : ""}.`;
}

export function organizationSnippet({ brand, category, audience, homepage }: { brand: string; category: string; audience?: string; homepage: string }): string {
  const origin = new URL(homepage).origin;
  const json = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand,
    url: homepage,
    logo: `${origin}/logo.png`,
    description: describe(category, audience),
    sameAs: [] as string[],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(json, null, 2)}\n</script>`;
}

function pageLabel(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "Home";
  let last = parts[parts.length - 1];
  try {
    last = decodeURIComponent(last);
  } catch {}
  return sentence(last.replace(/[-_]+/g, " ").trim());
}

export function llmsTxtSnippet({ brand, category, audience }: { brand: string; category: string; audience?: string }, pages: PageAudit[]): string {
  const lines = pages
    .filter((p) => p.verdict === "readable" || p.verdict === "thin")
    .slice(0, MAX_LLMS_LINKS)
    .map((p) => `- [${pageLabel(p.url)}](${p.url})${p.title ? `: ${p.title}` : ""}`);
  return [`# ${brand}`, "", `> ${describe(category, audience)}`, "", "## Key pages", "", ...lines].join("\n");
}

const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const brandMatches = (name: string | undefined, brand: string) => {
  if (!name) return false;
  const a = key(name);
  const b = key(brand);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
};

function accessArea(facts: AuditFacts, bots: BotResult[], findings: Finding[]): AreaScore {
  const read = facts.pages.filter(isRead);
  const home = read.find(isHome);
  const others = read.filter((p) => !isHome(p));
  const noindexOthers = others.filter((p) => p.noindex);
  let points = bots.reduce((sum, b) => sum + b.points, 0);
  if (home?.noindex) points -= NOINDEX_HOME_PENALTY;
  if (others.length) points -= NOINDEX_PAGES_PENALTY * (noindexOthers.length / others.length);

  if (facts.robots.kind === "unreachable") {
    findings.push({
      id: "robots-unreachable",
      area: "access",
      severity: "fail",
      impact: CRAWLER_POINTS,
      title: "Fix your robots.txt so crawlers don't stay away",
      detail: `robots.txt ${facts.robots.status === null ? "didn't answer" : `answered ${facts.robots.status}`}. When it errors, crawlers treat the whole site as off limits until it loads again.`,
    });
  } else {
    const blocked = bots.filter((b) => b.access === "robots" && b.role !== "training");
    if (blocked.length) {
      const tokens = blocked.map((b) => b.token);
      const assistants = [...new Set(blocked.map((b) => MODEL_LABELS[b.model]))];
      const named = blocked.some((b) => b.rule?.named);
      findings.push({
        id: "robots-blocked",
        area: "access",
        severity: blocked.some((b) => b.role === "search") ? "fail" : "warn",
        impact: blocked.reduce((sum, b) => sum + b.weight, 0),
        title: `Let ${listJoin(tokens)} read your site`,
        detail: `Your robots.txt keeps ${blocked.length === 1 ? "it" : "them"} out${named ? "" : " with its catch-all rule"}, so ${listJoin(assistants)} can't cite pages ${blocked.length === 1 ? "it" : "their crawlers"} can't read. Add these lines to robots.txt${named ? ", or delete the Disallow lines in their own groups" : ""}.`,
        snippet: { label: "Copy robots.txt lines", text: robotsSnippet(tokens) },
      });
    }
    const partial = bots.filter((b) => b.access === "partial" && b.role === "search");
    if (partial.length) {
      const paths = [...new Set(partial.flatMap((b) => b.blockedPaths))];
      findings.push({
        id: "robots-partial",
        area: "access",
        severity: "warn",
        impact: partial.reduce((sum, b) => sum + (b.weight - b.points), 0),
        title: `Open ${namePaths(paths)} to AI search crawlers`,
        detail: `robots.txt keeps ${listJoin(partial.map((b) => b.token))} away from ${namePaths(paths)}, so answers can't cite ${paths.length === 1 ? "it" : "them"}.`,
      });
    }
  }

  const walled = bots.filter((b) => b.access === "firewall");
  if (walled.length) {
    const statuses = [...new Set(walled.map((b) => (b.probe?.challenge ? "a bot check" : String(b.probe?.status))))];
    findings.push({
      id: "firewall",
      area: "access",
      severity: walled.some((b) => b.role === "search") ? "fail" : "warn",
      impact: walled.reduce((sum, b) => sum + b.weight, 0),
      title: `Let ${listJoin(walled.map((b) => b.token))} past your firewall`,
      detail: `Your robots.txt lets ${walled.length === 1 ? "it" : "them"} in, but your homepage answered ${listJoin(statuses, "or")} to ${walled.length === 1 ? "its" : "their"} name while a normal browser got in. That's usually a CDN or firewall setting that blocks AI bots (Cloudflare turns one on for new sites). Kioku's requests carry the name but not the crawlers' real addresses, so confirm it in your firewall's settings or logs.`,
    });
  }

  const unsure = bots.filter((b) => b.access === "unconfirmed");
  if (unsure.length) {
    findings.push({
      id: "bot-protection",
      area: "access",
      severity: "warn",
      impact: unsure.reduce((sum, b) => sum + (b.weight - b.points), 0),
      title: `Check that ${listJoin(unsure.map((b) => b.token))} get${unsure.length === 1 ? "s" : ""} past your bot protection`,
      detail: `Your homepage turned away requests carrying ${unsure.length === 1 ? "its name" : "their names"}, and Kioku's own crawler too, while a normal browser got in. Bot protection often lets real crawlers through by their addresses and only refuses look-alikes, so Pip can't confirm. Make sure your firewall allows verified AI crawlers and that no AI-bot block is switched on.`,
    });
  }

  if (home?.noindex) {
    findings.push({
      id: "noindex",
      area: "access",
      severity: "fail",
      impact: NOINDEX_HOME_PENALTY,
      title: "Remove noindex from your homepage",
      detail: "Your homepage tells search engines not to index it, so assistants that answer from Google's or Bing's index won't find it.",
    });
  } else if (noindexOthers.length) {
    findings.push({
      id: "noindex",
      area: "access",
      severity: "warn",
      impact: NOINDEX_PAGES_PENALTY * (noindexOthers.length / Math.max(others.length, 1)),
      title: `Check noindex on ${namePaths(noindexOthers.map((p) => pathOf(p.url)))}`,
      detail: "These pages tell search engines not to index them, so assistants that answer from search indexes won't find them. Fine for private pages, not for ones you want quoted.",
    });
  }
  if (home?.nosnippet) {
    findings.push({
      id: "nosnippet",
      area: "access",
      severity: "warn",
      impact: 3,
      title: "Drop nosnippet from your homepage",
      detail: "nosnippet stops search engines quoting the page, and Google also keeps it out of AI Overviews and AI Mode.",
    });
  }

  const out = bots.filter((b) => b.access === "robots" || b.access === "firewall").length;
  const partly = bots.filter((b) => b.access === "partial").length;
  const extras = [partly && `${partly} partly blocked`, unsure.length && `${unsure.length} unconfirmed`].filter(Boolean);
  const lead = out ? `${out} of ${bots.length} AI bots kept out` : unsure.length ? "No AI bots kept out for sure" : "No AI bots kept out";
  let note =
    facts.robots.kind === "unreachable"
      ? "robots.txt didn't load, so crawlers stay away"
      : out === 0 && extras.length === 0
        ? "Every AI crawler gets in"
        : [lead, ...extras].join(", ");
  if (home?.noindex) note += " · homepage set to noindex";
  return { area: "access", points: Math.max(0, points), max: CRAWLER_POINTS, note, checked: true };
}

function renderingArea(facts: AuditFacts, findings: Finding[]): AreaScore {
  const read = facts.pages.filter(isRead);
  const weightOf = (p: PageAudit) => (isHome(p) ? 2 : 1);
  const total = read.reduce((sum, p) => sum + weightOf(p), 0);
  const text = (p: PageAudit) => (p.verdict === "readable" ? 1 : p.verdict === "thin" ? 0.5 : 0);
  const basics = (p: PageAudit) => ((p.title ? 1 : 0) + (p.hasDescription ? 1 : 0) + (p.h1Count > 0 ? 1 : 0)) / 3;
  const points = (RENDERING_POINTS * read.reduce((sum, p) => sum + weightOf(p) * (0.8 * text(p) + 0.2 * basics(p)), 0)) / total;
  const lost = (pages: PageAudit[], share: (p: PageAudit) => number) => (RENDERING_POINTS * pages.reduce((sum, p) => sum + weightOf(p) * share(p), 0)) / total;

  const blank = read.filter((p) => p.verdict === "blank");
  const thin = read.filter((p) => p.verdict === "thin");
  if (blank.length) {
    const home = blank.find(isHome);
    const example = home ?? blank[0];
    findings.push({
      id: "blank-pages",
      area: "rendering",
      severity: home || blank.length / read.length >= 0.3 ? "fail" : "warn",
      impact: lost(blank, () => 0.8),
      title: home && blank.length === 1 ? "Serve your homepage's content without JavaScript" : `Serve ${namePaths(blank.map((p) => (isHome(p) ? "your homepage" : pathOf(p.url))))} without JavaScript`,
      detail: `AI crawlers read ${plural(example.words, "word")} on ${isHome(example) ? "your homepage" : pathOf(example.url)}${example.appShell ? ` (${example.appShell.charAt(0).toLowerCase()}${example.appShell.slice(1)})` : ""}. GPTBot, ClaudeBot and PerplexityBot don't run JavaScript, so render ${blank.length === 1 ? "this page" : "these pages"} on the server or pre-render ${blank.length === 1 ? "it" : "them"}.`,
    });
  }
  if (thin.length) {
    findings.push({
      id: "thin-pages",
      area: "rendering",
      severity: "warn",
      impact: lost(thin, () => 0.4),
      title: `Put more text in the HTML of ${namePaths(thin.map((p) => (isHome(p) ? "your homepage" : pathOf(p.url))))}`,
      detail: `${thin.length === 1 ? "It has" : "They have"} under ${READABLE_WORDS} words before JavaScript runs, which gives assistants little to quote. Make sure the main copy is in the page, not loaded afterwards.`,
    });
  }
  const missing = read.filter((p) => basics(p) < 1);
  if (missing.length) {
    const what = (p: PageAudit) => [!p.title && "title", !p.hasDescription && "description", p.h1Count === 0 && "main heading"].filter(Boolean) as string[];
    findings.push({
      id: "page-basics",
      area: "rendering",
      severity: "warn",
      impact: lost(missing, (p) => 0.2 * (1 - basics(p))),
      title: "Give every page a title, a description and a main heading",
      detail: `Assistants use these to tell what a page is about. Missing: ${missing
        .slice(0, MAX_PATHS_NAMED)
        .map((p) => `${isHome(p) ? "homepage" : pathOf(p.url)} (${listJoin(what(p))})`)
        .join("; ")}${missing.length > MAX_PATHS_NAMED ? `; and ${plural(missing.length - MAX_PATHS_NAMED, "more page")}` : ""}.`,
    });
  }

  const note =
    blank.length === 0 && thin.length === 0
      ? `All ${plural(read.length, "page")} readable without JavaScript`
      : blank.length && !thin.length
        ? `${blank.length} of ${plural(read.length, "page")} blank without JavaScript`
        : `${read.length - blank.length - thin.length} readable, ${thin.length} thin, ${blank.length} blank without JavaScript`;
  return { area: "rendering", points, max: RENDERING_POINTS, note, checked: true };
}

function structureArea(facts: AuditFacts, findings: Finding[]): AreaScore {
  const read = facts.pages.filter(isRead);
  const types = new Set(read.flatMap((p) => p.schemaTypes));
  const content = [...types].filter((t) => CONTENT_TYPES.has(t));
  const invalid = read.reduce((sum, p) => sum + p.invalidJsonLd, 0);
  const org = facts.organization;
  const matches = brandMatches(org?.name, facts.brand);
  let points = 0;
  if (org) {
    points += 7;
    if (matches) points += 2;
    if (org.sameAs > 0) points += 2;
    if (org.logo || org.url) points += 1;
  }
  if (types.has("WebSite")) points += 2;
  points += content.length >= 2 ? 6 : content.length === 1 ? 3 : 0;
  points -= Math.min(4, 2 * invalid);

  if (!org) {
    findings.push({
      id: "organization",
      area: "structure",
      severity: "warn",
      impact: 12,
      title: "Add Organization structured data",
      detail: "It tells assistants and search engines your official name, site, logo and profiles in a form they can't misread. Paste this into your homepage's <head>, swap in your logo's address and list your official profiles under sameAs.",
      snippet: { label: "Copy Organization JSON-LD", text: organizationSnippet({ brand: facts.brand, category: facts.category, audience: facts.audience, homepage: facts.homepage }) },
    });
  } else if (!matches || org.sameAs === 0 || !(org.logo || org.url)) {
    const gaps = [
      !matches && (org.name ? `its name is “${org.name}”, not ${facts.brand}` : "it has no name"),
      org.sameAs === 0 && "it lists no official profiles (sameAs)",
      !(org.logo || org.url) && "it has no logo or url",
    ].filter(Boolean) as string[];
    findings.push({
      id: "organization-details",
      area: "structure",
      severity: "warn",
      impact: (matches ? 0 : 2) + (org.sameAs ? 0 : 2) + (org.logo || org.url ? 0 : 1),
      title: "Complete your Organization data",
      detail: `Your Organization markup is there, but ${listJoin(gaps)}. Profiles in sameAs help assistants tie your brand to the right accounts.`,
    });
  }
  if (content.length === 0) {
    findings.push({
      id: "content-schema",
      area: "structure",
      severity: "warn",
      impact: 6,
      title: "Mark up your products, FAQs and articles",
      detail: "Pip found no Product, SoftwareApplication, FAQPage or Article markup on the pages it read. Adding it to pricing, product and FAQ pages makes facts like prices and answers easy to lift.",
    });
  }
  if (invalid > 0) {
    const pages = read.filter((p) => p.invalidJsonLd > 0).map((p) => (isHome(p) ? "your homepage" : pathOf(p.url)));
    findings.push({
      id: "invalid-json-ld",
      area: "structure",
      severity: "warn",
      impact: Math.min(4, 2 * invalid),
      title: `Fix ${plural(invalid, "structured data block")} that ${invalid === 1 ? "doesn't" : "don't"} parse`,
      detail: `Crawlers skip JSON-LD with a syntax error. Check the blocks on ${namePaths(pages)} with a JSON validator.`,
    });
  }

  const note = org
    ? content.length
      ? `Organization and ${content[0]} found`
      : "Organization found"
    : types.size
      ? `${[...types][0]} found, no Organization`
      : "No structured data found";
  return { area: "structure", points: Math.max(0, Math.min(STRUCTURE_POINTS, points)), max: STRUCTURE_POINTS, note, checked: true };
}

function discoveryArea(facts: AuditFacts, findings: Finding[]): AreaScore {
  const read = facts.pages.filter((p) => p.verdict === "readable" || p.verdict === "thin" || p.verdict === "blank");
  const canonicals = read.filter((p) => p.canonical).length;
  const share = read.length ? canonicals / read.length : 0;
  const { sitemap, llmsTxt } = facts;
  let points = 0;
  if (sitemap.found) points += 5 + (sitemap.listed ? 2 : 0);
  points += share >= 0.75 ? 3 : canonicals > 0 ? 1.5 : 0;
  if (llmsTxt.found) points += 3 + (llmsTxt.wellFormed ? 2 : 0);

  if (!sitemap.found) {
    findings.push({
      id: "sitemap",
      area: "discovery",
      severity: "warn",
      impact: 7,
      title: "Publish a sitemap",
      detail: "Pip found no sitemap at /sitemap.xml or in robots.txt. A sitemap helps search and AI crawlers find every page, including new ones.",
    });
  } else if (!sitemap.listed && sitemap.url) {
    findings.push({
      id: "sitemap-listed",
      area: "discovery",
      severity: "warn",
      impact: 2,
      title: "Point to your sitemap from robots.txt",
      detail: "Crawlers look for a Sitemap line in robots.txt. Add this one.",
      snippet: { label: "Copy robots.txt line", text: `Sitemap: ${sitemap.url}` },
    });
  }
  if (read.length && share < 0.75) {
    findings.push({
      id: "canonical",
      area: "discovery",
      severity: "warn",
      impact: 3 - (canonicals > 0 ? 1.5 : 0),
      title: "Add canonical tags",
      detail: `${read.length - canonicals} of ${plural(read.length, "page")} Pip read have no canonical tag. It tells crawlers which address is the real one, so citations don't split across copies.`,
    });
  }
  if (!llmsTxt.found) {
    findings.push({
      id: "llms-txt",
      area: "discovery",
      severity: "warn",
      impact: 5,
      title: "Add an llms.txt",
      detail: "A short Markdown map of your best pages at /llms.txt. No major assistant has said it reads one yet, so it counts for little, but it takes minutes.",
      snippet: { label: "Copy starter llms.txt", text: llmsTxtSnippet({ brand: facts.brand, category: facts.category, audience: facts.audience }, facts.pages) },
    });
  } else if (!llmsTxt.wellFormed) {
    findings.push({
      id: "llms-txt-format",
      area: "discovery",
      severity: "warn",
      impact: 2,
      title: "Tidy up your llms.txt",
      detail: "It should start with a # title, then a > summary and ## sections of links to your key pages.",
    });
  }

  const note = `${sitemap.found ? "Sitemap found" : "No sitemap"} · ${llmsTxt.found ? "llms.txt found" : "no llms.txt"}`;
  return { area: "discovery", points: Math.min(DISCOVERY_POINTS, points), max: DISCOVERY_POINTS, note, checked: true };
}

function unchecked(facts: AuditFacts): AreaScore[] {
  const byRobots = facts.pages.length > 0 && facts.pages.every((p) => p.verdict === "skipped" && p.note === ROBOTS_SKIP);
  const note = byRobots
    ? "Not checked: robots.txt keeps Kioku out"
    : facts.crawlersRefused
      ? "Not checked: the site turned Kioku's crawler away"
      : "Not checked: Pip couldn't read any pages";
  return [
    { area: "rendering", points: 0, max: RENDERING_POINTS, note, checked: false },
    { area: "structure", points: 0, max: STRUCTURE_POINTS, note, checked: false },
    { area: "discovery", points: 0, max: DISCOVERY_POINTS, note, checked: false },
  ];
}

/** Why a page was skipped when robots.txt closes it to Kioku's crawler. */
export const ROBOTS_SKIP = "robots.txt asks crawlers to stay out";

export function scoreAudit(facts: AuditFacts, meta: { checkedAt: string; elapsedMs: number }): SiteAudit {
  const paths = [...new Set(facts.pages.map((p) => pathOf(p.url)))];
  const bots = evaluateBots(facts.robots, facts.probes, paths, facts.crawlersRefused);
  const findings: Finding[] = [];
  const anyRead = facts.pages.some(isRead);
  const access = accessArea(facts, bots, findings);
  const rest = anyRead ? [renderingArea(facts, findings), structureArea(facts, findings), discoveryArea(facts, findings)] : unchecked(facts);
  const areas = [access, ...rest].map((area) => ({ ...area, points: Math.round(area.points) }));
  const score = anyRead ? areas.reduce((sum, a) => sum + a.points, 0) : Math.round((100 * areas[0].points) / CRAWLER_POINTS);
  findings.sort((a, b) => b.impact - a.impact || (a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1));
  return {
    version: 1,
    site: facts.site,
    homepage: facts.homepage,
    checkedAt: meta.checkedAt,
    elapsedMs: meta.elapsedMs,
    score,
    grade: gradeFor(score),
    areas,
    robots: { state: facts.robots.kind, status: facts.robots.status },
    bots,
    pages: facts.pages,
    organization: facts.organization ? { ...facts.organization, matchesBrand: brandMatches(facts.organization.name, facts.brand) } : null,
    llmsTxt: facts.llmsTxt,
    sitemap: facts.sitemap,
    findings: findings.map((f) => ({ ...f, impact: Math.round(f.impact * 10) / 10 })),
  };
}
