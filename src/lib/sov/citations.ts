import type { Citation } from "@/lib/sov/types";

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
    const url = raw.trim();
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
