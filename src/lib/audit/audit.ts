import { AI_BOTS, BROWSER_USER_AGENT, KIOKU_BOT_TOKEN, KIOKU_USER_AGENT } from "@/lib/audit/bots";
import { isPlainText, parseLlmsTxt, parseSitemap } from "@/lib/audit/files";
import { analyzeHtml, robotsDirectives, type HtmlFacts, type OrganizationNode } from "@/lib/audit/html";
import { MAX_PAGES, pageKey, pickPages, type PagePick } from "@/lib/audit/pages";
import { robotsFromResponse, verdictFor, type RobotsState } from "@/lib/audit/robots";
import { safeFetch, type FetchedPage, type FetchResult, type SafeFetchOptions } from "@/lib/audit/safe-fetch";
import { pageVerdict, ROBOTS_SKIP, scoreAudit } from "@/lib/audit/score";
import type { AuditEvent, LlmsTxtFacts, PageAudit, Probe, SiteAudit, SitemapFacts } from "@/lib/audit/types";

export interface AuditInput {
  /** The brand's domain, e.g. "thimble.studio". */
  site: string;
  brand: string;
  category: string;
  audience?: string;
  /** The brand's own pages that the check's answers cited, with how often. */
  cited: { url: string; count: number }[];
}

export type Fetcher = (url: string, options: SafeFetchOptions) => Promise<FetchResult>;

export interface AuditDeps {
  fetch?: Fetcher;
  now?: () => number;
  /** Pages aren't started once less than one page's timeout is left of this. */
  budgetMs?: number;
  pageConcurrency?: number;
}

export type AuditResult = { ok: true; audit: SiteAudit } | { ok: false; message: string };

const PAGE_TIMEOUT_MS = 8_000;
const DEFAULT_BUDGET_MS = 45_000;
const PROBE_CONCURRENCY = 3;
const PAGE_CONCURRENCY = 4;
const OUT_OF_TIME = "Pip ran out of time before reading it";
const CHALLENGE_TITLE = /<title[^>]*>\s*(?:just a moment|attention required|access denied|checking your browser|verifying you are human|security check|ddos-guard)/i;

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function isChallenge(page: FetchedPage): boolean {
  if (page.headers["cf-mitigated"]?.toLowerCase() === "challenge") return true;
  if (page.headers["x-vercel-mitigated"]) return true;
  return CHALLENGE_TITLE.test(page.body.slice(0, 20_000));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** The control request: the homepage as a normal browser sees it. https first, then http if https doesn't answer. */
async function openHomepage(site: string, fetcher: Fetcher): Promise<{ ok: true; page: FetchedPage } | { ok: false; message: string }> {
  let last = "it didn't answer";
  for (const scheme of ["https", "http"]) {
    const result = await fetcher(`${scheme}://${site}/`, { userAgent: BROWSER_USER_AGENT, timeoutMs: 10_000, maxBytes: 500_000 });
    if (result.ok) {
      const { page } = result;
      if (page.status >= 400) {
        return { ok: false, message: `${site} answered ${page.status} to a normal browser too, so Pip can't tell what AI crawlers get. Some sites refuse requests from cloud servers like Kioku's.` };
      }
      if (isChallenge(page)) {
        return { ok: false, message: `${site} showed a bot check even to a normal browser, so Pip can't tell what AI crawlers get.` };
      }
      return { ok: true, page };
    }
    if (result.reason !== "network" && result.reason !== "timeout") return { ok: false, message: result.message };
    last = result.message.replace(/^Kioku /, "").replace(/\.$/, "");
  }
  return { ok: false, message: `Pip couldn't open ${site}: ${last.charAt(0).toLowerCase()}${last.slice(1)}.` };
}

function skippedPage(pick: PagePick, note: string): PageAudit {
  return { url: pick.url, verdict: "skipped", words: 0, hasDescription: false, h1Count: 0, canonical: false, noindex: false, nosnippet: false, schemaTypes: [], invalidJsonLd: 0, cited: pick.cited, note };
}

function failedPage(pick: PagePick, note: string, status?: number): PageAudit {
  return { ...skippedPage(pick, note), verdict: "failed", status };
}

function readPage(result: FetchResult, pick: PagePick, sameSite: (url: string) => boolean): { page: PageAudit; facts: HtmlFacts | null } {
  if (!result.ok) return { page: failedPage(pick, result.message), facts: null };
  const fetched = result.page;
  if (isChallenge(fetched)) return { page: failedPage(pick, "Showed a bot check instead of the page", fetched.status), facts: null };
  if (fetched.status >= 400) return { page: failedPage(pick, `Answered ${fetched.status}`, fetched.status), facts: null };
  if (!sameSite(fetched.url)) return { page: failedPage(pick, "Redirects to another site", fetched.status), facts: null };
  if (fetched.contentType && !fetched.contentType.includes("html")) {
    return { page: failedPage(pick, `Not a web page (${fetched.contentType})`, fetched.status), facts: null };
  }
  const facts = analyzeHtml(fetched.body, fetched.url);
  const directives = [...facts.robots, ...robotsDirectives(fetched.headers["x-robots-tag"])];
  return {
    facts,
    page: {
      url: fetched.url,
      verdict: pageVerdict(facts.words, facts.appShell),
      status: fetched.status,
      words: facts.words,
      title: facts.title,
      hasDescription: Boolean(facts.description),
      h1Count: facts.h1Count,
      canonical: Boolean(facts.canonical),
      noindex: directives.includes("noindex") || directives.includes("none"),
      nosnippet: directives.includes("nosnippet") || directives.includes("max-snippet:0"),
      appShell: facts.appShell,
      schemaTypes: facts.schemaTypes,
      invalidJsonLd: facts.invalidJsonLd,
      cited: pick.cited,
    },
  };
}

async function readSitemap(
  origin: string,
  robots: RobotsState,
  allowed: (url: string) => boolean,
  sameSite: (url: string) => boolean,
  fetcher: Fetcher,
): Promise<{ facts: SitemapFacts; pages: string[] }> {
  const listed = robots.kind === "found" ? robots.file.sitemaps.filter(sameSite) : [];
  const get = async (url: string) => {
    if (!allowed(url)) return null;
    const result = await fetcher(url, { userAgent: KIOKU_USER_AGENT, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxBytes: 5_000_000, timeoutMs: PAGE_TIMEOUT_MS });
    return result.ok && result.page.status < 400 ? parseSitemap(result.page.body) : null;
  };
  for (const url of listed.length ? listed.slice(0, 2) : [`${origin}/sitemap.xml`]) {
    const parsed = await get(url);
    if (!parsed || (parsed.pages.length === 0 && parsed.sitemaps.length === 0)) continue;
    let pages = parsed.pages;
    const child = parsed.sitemaps.find((s) => sameSite(s));
    if (pages.length === 0 && child) pages = (await get(child))?.pages ?? [];
    return { facts: { found: true, listed: listed.length > 0, url, pages: pages.length }, pages };
  }
  return { facts: { found: false, listed: false, pages: 0 }, pages: [] };
}

async function readLlmsTxt(origin: string, allowed: (url: string) => boolean, fetcher: Fetcher): Promise<LlmsTxtFacts> {
  const get = async (path: string) => {
    const url = `${origin}${path}`;
    if (!allowed(url)) return null;
    const result = await fetcher(url, { userAgent: KIOKU_USER_AGENT, accept: "text/plain,text/markdown;q=0.9,*/*;q=0.5", maxBytes: 500_000, timeoutMs: PAGE_TIMEOUT_MS });
    if (!result.ok || result.page.status !== 200 || !result.page.body.trim()) return null;
    return isPlainText(result.page.contentType, result.page.body) ? result.page.body : null;
  };
  const [main, full] = await Promise.all([get("/llms.txt"), get("/llms-full.txt")]);
  if (!main) return { found: false, wellFormed: false, links: 0, full: Boolean(full) };
  const shape = parseLlmsTxt(main);
  return { found: true, wellFormed: Boolean(shape.title) && shape.links > 0, title: shape.title, links: shape.links, full: Boolean(full) };
}

/**
 * Reads a site the way AI crawlers do and grades it. Kioku's own requests obey robots.txt; the exceptions are
 * robots.txt itself, one homepage request as a normal browser (the control) and one per AI bot (the probes).
 */
export async function runAudit(input: AuditInput, emit: (event: AuditEvent) => void, deps: AuditDeps = {}): Promise<AuditResult> {
  const fetcher: Fetcher = deps.fetch ?? ((url, options) => safeFetch(url, options));
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const timeLeft = () => budget - (now() - started);

  emit({ type: "step", step: "home", message: `Opening ${input.site}` });
  const control = await openHomepage(input.site, fetcher);
  if (!control.ok) return control;
  const homepage = control.page.url;
  const origin = new URL(homepage).origin;
  const hosts = new Set([bareHost(input.site), bareHost(new URL(homepage).hostname)]);
  const sameSite = (url: string) => {
    try {
      return hosts.has(bareHost(new URL(url).hostname));
    } catch {
      return false;
    }
  };
  const rebase = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!sameSite(url)) return url;
      const home = new URL(origin);
      parsed.protocol = home.protocol;
      parsed.host = home.host;
      return parsed.toString();
    } catch {
      return url;
    }
  };

  emit({ type: "step", step: "robots", message: "Reading robots.txt" });
  const robotsResult = await fetcher(`${origin}/robots.txt`, { userAgent: KIOKU_USER_AGENT, accept: "text/plain,*/*;q=0.5", maxBytes: 512_000, timeoutMs: PAGE_TIMEOUT_MS });
  const robots = robotsFromResponse(robotsResult.ok ? robotsResult.page.status : null, robotsResult.ok ? robotsResult.page.body : null);
  const allowed = (url: string) => verdictFor(robots, KIOKU_BOT_TOKEN, pathOf(url)).allowed;

  emit({ type: "step", step: "bots", message: "Knocking as each AI crawler" });
  const probes: Record<string, Probe> = {};
  await mapLimit(
    AI_BOTS.filter((bot) => bot.userAgent),
    PROBE_CONCURRENCY,
    async (bot) => {
      const result = await fetcher(homepage, { userAgent: bot.userAgent!, timeoutMs: PAGE_TIMEOUT_MS, maxBytes: 300_000 });
      probes[bot.token] = result.ok ? { status: result.page.status, challenge: isChallenge(result.page) } : { status: null, challenge: false };
    },
  );

  emit({ type: "step", step: "files", message: "Looking for llms.txt and your sitemap" });
  const [sitemap, llmsTxt] = await Promise.all([readSitemap(origin, robots, allowed, sameSite, fetcher), readLlmsTxt(origin, allowed, fetcher)]);

  emit({ type: "step", step: "pages", message: "Reading your pages" });
  const citedByKey = new Map<string, number>();
  for (const c of input.cited) citedByKey.set(pageKey(rebase(c.url)), (citedByKey.get(pageKey(rebase(c.url))) ?? 0) + c.count);
  const homePick: PagePick = { url: homepage, cited: citedByKey.get(pageKey(homepage)) ?? 0 };
  let home: { page: PageAudit; facts: HtmlFacts | null };
  let crawlersRefused = false;
  if (allowed(homepage)) {
    const result = await fetcher(homepage, { userAgent: KIOKU_USER_AGENT, timeoutMs: PAGE_TIMEOUT_MS, maxBytes: 2_000_000 });
    crawlersRefused = result.ok && (result.page.status >= 400 || isChallenge(result.page));
    home = readPage(result, homePick, sameSite);
  } else {
    home = { page: skippedPage(homePick, ROBOTS_SKIP), facts: null };
  }

  const candidates = [...(home.facts?.links ?? []), ...sitemap.pages].map(rebase).filter((url) => sameSite(url) && allowed(url));
  const cited = [...citedByKey].map(([key, count]) => ({ url: rebase(input.cited.find((c) => pageKey(rebase(c.url)) === key)!.url), count }));
  const picks = crawlersRefused ? [homePick] : pickPages({ origin, site: bareHost(new URL(homepage).hostname), cited, candidates, max: MAX_PAGES });
  const total = picks.length;
  let done = 1;
  emit({ type: "page", url: homepage, done, total });

  const rest = await mapLimit(picks.slice(1), deps.pageConcurrency ?? PAGE_CONCURRENCY, async (pick) => {
    let read: { page: PageAudit; facts: HtmlFacts | null };
    if (!allowed(pick.url)) read = { page: skippedPage(pick, ROBOTS_SKIP), facts: null };
    else if (timeLeft() < PAGE_TIMEOUT_MS) read = { page: skippedPage(pick, OUT_OF_TIME), facts: null };
    else read = readPage(await fetcher(pick.url, { userAgent: KIOKU_USER_AGENT, timeoutMs: PAGE_TIMEOUT_MS, maxBytes: 2_000_000 }), pick, sameSite);
    emit({ type: "page", url: pick.url, done: ++done, total });
    return read;
  });

  emit({ type: "step", step: "score", message: "Grading what Pip found" });
  const organization: OrganizationNode | null = home.facts?.organization ?? rest.find((r) => r.facts?.organization)?.facts?.organization ?? null;
  const audit = scoreAudit(
    {
      site: input.site,
      homepage,
      brand: input.brand,
      category: input.category,
      audience: input.audience,
      robots,
      probes,
      pages: [home.page, ...rest.map((r) => r.page)],
      organization,
      llmsTxt,
      sitemap: sitemap.facts,
      crawlersRefused,
    },
    { checkedAt: new Date(now()).toISOString(), elapsedMs: now() - started },
  );
  return { ok: true, audit };
}
