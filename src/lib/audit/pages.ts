/** Which pages of a site to read: the homepage, the pages assistants cited, then answer-shaped pages. */

export interface PagePick {
  url: string;
  /** Times the check's answers cited this page. */
  cited: number;
}

export const MAX_PAGES = 12;
const MAX_CITED = 4;
const MAX_PER_SECTION = 3;

/** The pages Pip's next steps tell people to publish, most useful to an assistant first. */
const PRIORITY = [
  "pricing",
  "plans",
  "compare",
  "comparison",
  "vs",
  "versus",
  "alternative",
  "alternatives",
  "features",
  "product",
  "products",
  "solutions",
  "use-cases",
  "faq",
  "faqs",
  "docs",
  "documentation",
  "getting-started",
  "guide",
  "guides",
  "customers",
  "integrations",
  "security",
  "how-it-works",
  "about",
  "learn",
  "blog",
];
const SKIP = new Set([
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "cart",
  "checkout",
  "account",
  "privacy",
  "privacy-policy",
  "terms",
  "tos",
  "cookie",
  "cookies",
  "legal",
  "careers",
  "jobs",
  "press",
  "status",
  "search",
  "tag",
  "tags",
  "category",
  "author",
  "feed",
  "rss",
  "unsubscribe",
  "cdn-cgi",
  "wp-admin",
  "wp-login.php",
  "wp-json",
]);
const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/index\.(?:html?|php)$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `${bareHost(parsed.hostname)}${path || "/"}`;
  } catch {
    return url;
  }
}

function segments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s).toLowerCase();
      } catch {
        return s.toLowerCase();
      }
    });
}

function rank(parts: string[]): number {
  let best = PRIORITY.length;
  for (const part of parts) {
    for (const word of [part, ...part.split(/[-_.]/)]) {
      const index = PRIORITY.indexOf(word);
      if (index >= 0 && index < best) best = index;
    }
  }
  return best * 10 + parts.length;
}

export function pickPages({
  origin,
  site,
  cited,
  candidates,
  max = MAX_PAGES,
}: {
  /** Where the homepage ended up after redirects, e.g. "https://www.thimble.studio". */
  origin: string;
  /** The brand's domain, e.g. "thimble.studio". Only it and its www host are read. */
  site: string;
  cited: { url: string; count: number }[];
  candidates: string[];
  max?: number;
}): PagePick[] {
  const picks: PagePick[] = [];
  const keys = new Set<string>();
  const sections = new Map<string, number>();
  const home = new URL("/", origin).toString();

  const usable = (raw: string): URL | null => {
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      return null;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || bareHost(url.hostname) !== bareHost(site)) return null;
    const parts = segments(url);
    if (parts.some((p) => SKIP.has(p))) return null;
    if (parts[0] && LOCALE.test(parts[0]) && !/^en(?:[-_]|$)/i.test(parts[0])) return null;
    url.hash = "";
    url.search = "";
    return url;
  };
  const add = (url: URL, count: number, capSections: boolean) => {
    if (picks.length >= max) return;
    const key = pageKey(url.toString());
    if (keys.has(key)) return;
    const parts = segments(url);
    const section = (parts[0] && LOCALE.test(parts[0]) ? parts[1] : parts[0]) ?? "";
    if (capSections && section && (sections.get(section) ?? 0) >= MAX_PER_SECTION) return;
    keys.add(key);
    if (section) sections.set(section, (sections.get(section) ?? 0) + 1);
    picks.push({ url: url.toString(), cited: count });
  };

  add(new URL(home), 0, false);
  const citedPages = cited
    .map((c) => ({ url: usable(c.url), count: c.count }))
    .filter((c): c is { url: URL; count: number } => c.url !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CITED);
  for (const page of citedPages) add(page.url, page.count, false);

  const ranked = candidates
    .map((raw, index) => ({ url: usable(raw), index }))
    .filter((c): c is { url: URL; index: number } => c.url !== null)
    .map((c) => ({ ...c, rank: rank(segments(c.url)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  for (const candidate of ranked) add(candidate.url, 0, true);
  return picks;
}
