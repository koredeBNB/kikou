import { KIOKU_BOT_TOKEN } from "@/lib/audit/bots";
import { summarizePage, type PageSummary } from "@/lib/audit/html";
import { robotsFromResponse, verdictFor } from "@/lib/audit/robots";
import { safeFetch, type FetchResult, type SafeFetchOptions } from "@/lib/audit/safe-fetch";
import { MAX_LOOKUP_SITES } from "@/lib/intake/brief";

export type SiteFetcher = (url: string, options: SafeFetchOptions) => Promise<FetchResult>;

/** What the brand's own homepage says about it, read the way Kioku's crawler reads any page. */
export interface SiteSnapshot extends PageSummary {
  site: string;
  /** The URL that answered, after redirects. */
  url: string;
}

const USER_AGENT = "Mozilla/5.0 (compatible; KiokuBot/1.0; brand lookup; +https://kioku.vercel.app)";
const ROBOTS_TIMEOUT_MS = 2500;
const PAGE_TIMEOUT_MS = 4000;

/** Reads a brand's homepage, as long as robots.txt lets KiokuBot in. Null when there's nothing to read. */
export async function readBrandSite(site: string, fetcher: SiteFetcher = safeFetch): Promise<SiteSnapshot | null> {
  const origin = `https://${site}`;
  const robots = await fetcher(`${origin}/robots.txt`, { userAgent: USER_AGENT, accept: "text/plain,*/*;q=0.5", maxBytes: 512_000, timeoutMs: ROBOTS_TIMEOUT_MS });
  const state = robotsFromResponse(robots.ok ? robots.page.status : null, robots.ok ? robots.page.body : null);
  if (!verdictFor(state, KIOKU_BOT_TOKEN, "/").allowed) return null;

  const home = await fetcher(`${origin}/`, { userAgent: USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", maxBytes: 1_000_000, timeoutMs: PAGE_TIMEOUT_MS });
  if (!home.ok || home.page.status >= 400 || !home.page.contentType.includes("html")) return null;
  const summary = summarizePage(home.page.body);
  if (!summary.title && !summary.description && !summary.text) return null;
  return { site, url: home.page.url, ...summary };
}

/** Reads the first two sites side by side, leaving out any it couldn't read. */
export async function readBrandSites(sites: string[], fetcher: SiteFetcher = safeFetch): Promise<SiteSnapshot[]> {
  const read = await Promise.all(sites.slice(0, MAX_LOOKUP_SITES).map((site) => readBrandSite(site, fetcher).catch(() => null)));
  return read.filter((snapshot): snapshot is SiteSnapshot => snapshot !== null);
}
