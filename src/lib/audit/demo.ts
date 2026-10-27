import { pageKey } from "@/lib/audit/pages";
import { robotsFromResponse } from "@/lib/audit/robots";
import { scoreAudit } from "@/lib/audit/score";
import type { PageAudit, Probe, SiteAudit } from "@/lib/audit/types";

/** Thimble is fictional, so the sample report's audit is made up too, but graded by the real scorer. */
const SITE = "thimble.studio";
const ORIGIN = `https://${SITE}`;
const HOMEPAGE = `${ORIGIN}/`;
const ROBOTS = `User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: *
Disallow: /app/

Sitemap: ${ORIGIN}/sitemap.xml
`;
const SHELL = "An empty #root element that JavaScript fills in";
const MAX_CITED_PAGES = 2;

function page(path: string, fields: Partial<PageAudit>): PageAudit {
  return {
    url: `${ORIGIN}${path}`,
    verdict: "readable",
    status: 200,
    words: 900,
    hasDescription: true,
    h1Count: 1,
    canonical: true,
    noindex: false,
    nosnippet: false,
    schemaTypes: [],
    invalidJsonLd: 0,
    cited: 0,
    ...fields,
  };
}

const titleFor = (path: string) => {
  const slug = path.split("/").filter(Boolean).at(-1) ?? "";
  const words = slug.replace(/[-_]+/g, " ").trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} · Thimble`;
};

export function buildDemoAudit(cited: { url: string; count: number }[], now: Date = new Date()): SiteAudit {
  const counts = new Map<string, number>();
  for (const c of cited) counts.set(pageKey(c.url), (counts.get(pageKey(c.url)) ?? 0) + c.count);
  const top = [...counts]
    .filter(([key]) => key !== `${SITE}/`)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CITED_PAGES)
    .map(([key, count]) => ({ path: key.slice(SITE.length), count }));
  const fill = ["/blog/remote-team-rituals", "/blog/client-feedback-loops"].map((path) => ({ path, count: 0 }));
  const articles = [...top, ...fill].slice(0, MAX_CITED_PAGES);

  const pages = [
    page("/", { words: 1180, title: "Thimble · Project tracking for small design studios", schemaTypes: ["Organization"], cited: counts.get(`${SITE}/`) ?? 0 }),
    ...articles.map((a, i) => page(a.path, { words: 1640 - i * 210, title: titleFor(a.path), schemaTypes: ["BlogPosting"], cited: a.count })),
    page("/pricing", { verdict: "blank", words: 22, title: "Pricing · Thimble", h1Count: 0, canonical: false, appShell: SHELL }),
    page("/compare/quiltboard", { verdict: "blank", words: 31, title: "Thimble vs Quiltboard", hasDescription: false, h1Count: 0, canonical: false, appShell: SHELL }),
    page("/docs/getting-started", { words: 2050, title: "Getting started · Thimble docs" }),
    page("/features", { words: 870, title: "Features · Thimble" }),
    page("/customers", { verdict: "thin", words: 118, title: "Customers · Thimble", canonical: false }),
  ];
  const probes: Record<string, Probe> = {};
  for (const token of ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User", "ClaudeBot", "Googlebot", "Perplexity-User"]) probes[token] = { status: 200, challenge: false };
  probes.PerplexityBot = { status: 403, challenge: false };

  return scoreAudit(
    {
      site: SITE,
      homepage: HOMEPAGE,
      brand: "Thimble",
      category: "project tracker",
      audience: "small design studios",
      robots: robotsFromResponse(200, ROBOTS),
      probes,
      pages,
      organization: { name: "Thimble", url: HOMEPAGE, logo: true, sameAs: 0 },
      llmsTxt: { found: false, wellFormed: false, links: 0, full: false },
      sitemap: { found: true, listed: true, url: `${ORIGIN}/sitemap.xml`, pages: 64 },
    },
    { checkedAt: now.toISOString(), elapsedMs: 6_400 },
  );
}
