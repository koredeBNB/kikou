import type { Brief, Citation } from "@/lib/sov/types";

const URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^[\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"*_]+$/;

function count(value: string, char: string): number {
  return value.split(char).length - 1;
}

function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING_PUNCTUATION, "");
    if (url.endsWith(")") && count(url, "(") < count(url, ")")) url = url.slice(0, -1);
    if (url === before) return url;
  }
}

// `ref` is left alone: some sites use it for real content (GitHub branches, for one).
const TRACKING_PARAM =
  /^(?:utm_\w+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|_hsenc|_hsmi|__hstc|__hssc|__hsfp|igshid|mkt_tok|srsltid|trk|_ga|_gl|ref_src)$/i;

/** Removes tracking parameters such as `utm_source=openai`. URLs with none come back unchanged. */
export function stripTracking(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const tracking = [...parsed.searchParams.keys()].filter((key) => TRACKING_PARAM.test(key));
  if (tracking.length === 0) return url;
  for (const key of tracking) parsed.searchParams.delete(key);
  return parsed.toString();
}

export function domainOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function dedupeKey(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!domainOf(url)) continue;
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

export function collectCitations(text: string, providerCitations: string[] = []): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const raw of [...providerCitations, ...extractUrls(text)]) {
    const url = stripTracking(raw.trim());
    const domain = domainOf(url);
    if (!domain) continue;
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ url, domain });
  }
  return citations;
}

/** Accepts "acme.io", "www.acme.io" or a full URL. */
export function siteDomain(website: string | undefined): string | null {
  if (!website?.trim()) return null;
  const value = website.trim();
  return domainOf(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

export const MAX_SITES = 5;

/** A domain counts as one of `sites` when it's the same or a subdomain of it ("docs.acme.io" for "acme.io"). */
export const coveredBy = (domain: string, sites: string[]) => sites.some((site) => domain === site || domain.endsWith(`.${site}`));

/** Domains in order, without repeats or subdomains of others in the list, at most `MAX_SITES`. */
export function cleanSites(sites: (string | undefined)[]): string[] {
  const domains = [...new Set(sites.map(siteDomain).filter((d): d is string => d !== null))];
  return domains.filter((d) => !coveredBy(d, domains.filter((other) => other !== d))).slice(0, MAX_SITES);
}

/** The brand's own domains, main site first. */
export const ownDomains = (brief: Pick<Brief, "website" | "otherSites">) => cleanSites([brief.website, ...(brief.otherSites ?? [])]);

/** `otherSites` as clean domains, leaving out the main site and its subdomains, so the list stays within `MAX_SITES` in all. */
export function otherSitesOf(website: string | undefined, others: unknown): string[] {
  if (!Array.isArray(others)) return [];
  const main = siteDomain(website);
  const domains = cleanSites(others.map((site) => (typeof site === "string" ? site.slice(0, 120) : undefined)));
  return domains.filter((domain) => !main || !coveredBy(domain, [main])).slice(0, MAX_SITES - 1);
}

/** Brief fields for a list of the brand's sites: the first is the main one. Empty fields are cleared. */
export function siteFields(sites: (string | undefined)[]): Pick<Brief, "website" | "otherSites"> {
  const [website, ...others] = cleanSites(sites);
  return { website, otherSites: others.length ? others : undefined };
}
