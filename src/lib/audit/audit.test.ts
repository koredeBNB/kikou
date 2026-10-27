import { describe, expect, it } from "vitest";
import { runAudit, type AuditInput, type Fetcher } from "@/lib/audit/audit";
import { BROWSER_USER_AGENT, KIOKU_USER_AGENT } from "@/lib/audit/bots";
import type { FetchResult, SafeFetchOptions } from "@/lib/audit/safe-fetch";
import type { AuditEvent } from "@/lib/audit/types";

type Route = (ua: string) => { status: number; body?: string; type?: string; headers?: Record<string, string>; url?: string } | "down";

const html = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function site(routes: Record<string, Route>): { fetch: Fetcher; calls: { url: string; ua: string }[] } {
  const calls: { url: string; ua: string }[] = [];
  const fetch: Fetcher = async (url: string, options: SafeFetchOptions): Promise<FetchResult> => {
    calls.push({ url, ua: options.userAgent });
    const route = routes[url];
    const answer = route ? route(options.userAgent) : { status: 404, body: "Not found", type: "text/html" };
    if (answer === "down") return { ok: false, reason: "network", message: "Kioku couldn't connect to the site.", url };
    return {
      ok: true,
      page: {
        url: answer.url ?? url,
        status: answer.status,
        headers: answer.headers ?? {},
        contentType: answer.type ?? "text/html",
        body: answer.body ?? "",
        redirects: answer.url ? [url] : [],
        truncated: false,
      },
    };
  };
  return { fetch, calls };
}

const W = "https://www.thimble.studio";
const HOME = html(
  `<h1>Thimble</h1><p>${words(400)}</p><a href="/pricing">Pricing</a><a href="/compare/quiltboard">Compare</a><a href="/admin/settings">Admin</a><a href="/login">Log in</a>`,
  `<title>Thimble</title><meta name="description" content="Project tracker"><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"Organization","name":"Thimble","url":"https://thimble.studio","sameAs":["https://x.com/thimble"]}</script><script type="application/ld+json">{"@type":"WebSite"}</script>`,
);
const READABLE = (title: string, type?: string) =>
  html(`<h1>${title}</h1><p>${words(500)}</p>`, `<title>${title}</title><meta name="description" content="x"><link rel="canonical" href="#">${type ? `<script type="application/ld+json">{"@type":"${type}"}</script>` : ""}`);
const SHELL = html(`<div id="root"></div><script src="/app.js"></script>`, "<title>Pricing</title>");

const thimbleRoutes = (): Record<string, Route> => ({
  "https://thimble.studio/": (ua) => (ua === BROWSER_USER_AGENT ? { status: 200, body: HOME, url: `${W}/` } : { status: 200, body: HOME }),
  [`${W}/robots.txt`]: () => ({
    status: 200,
    type: "text/plain",
    body: `User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n\nSitemap: ${W}/sitemap.xml\n`,
  }),
  [`${W}/`]: (ua) => (ua.includes("PerplexityBot/") ? { status: 403, body: "Forbidden" } : { status: 200, body: HOME }),
  [`${W}/sitemap.xml`]: () => ({
    status: 200,
    type: "application/xml",
    body: `<urlset><url><loc>${W}/</loc></url><url><loc>${W}/pricing</loc></url><url><loc>${W}/docs/getting-started</loc></url><url><loc>${W}/blog/a</loc></url></urlset>`,
  }),
  [`${W}/pricing`]: () => ({ status: 200, body: SHELL }),
  [`${W}/compare/quiltboard`]: () => ({ status: 200, body: READABLE("Thimble vs Quiltboard", "FAQPage") }),
  [`${W}/docs/getting-started`]: () => ({ status: 200, body: READABLE("Getting started", "TechArticle") }),
  [`${W}/blog/a`]: () => ({ status: 200, body: READABLE("Rituals") }),
});

const input: AuditInput = {
  site: "thimble.studio",
  brand: "Thimble",
  category: "project tracker",
  audience: "small design studios",
  cited: [{ url: "https://thimble.studio/docs/getting-started?utm_source=x", count: 4 }],
};

describe("runAudit", () => {
  it("audits a site end to end", async () => {
    const { fetch, calls } = site(thimbleRoutes());
    const events: AuditEvent[] = [];
    const result = await runAudit(input, (e) => events.push(e), { fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const audit = result.audit;

    expect(audit.site).toBe("thimble.studio");
    expect(audit.homepage).toBe(`${W}/`);
    expect(audit.pages.map((p) => [new URL(p.url).pathname, p.verdict, p.cited])).toEqual([
      ["/", "readable", 0],
      ["/docs/getting-started", "readable", 4],
      ["/pricing", "blank", 0],
      ["/compare/quiltboard", "readable", 0],
      ["/blog/a", "readable", 0],
    ]);
    const access = Object.fromEntries(audit.bots.map((b) => [b.token, b.access]));
    expect(access).toMatchObject({ GPTBot: "robots", ClaudeBot: "robots", PerplexityBot: "firewall", "OAI-SearchBot": "allowed", Googlebot: "allowed" });
    expect(audit.sitemap).toMatchObject({ found: true, listed: true, pages: 4 });
    expect(audit.llmsTxt.found).toBe(false);
    expect(audit.organization).toMatchObject({ name: "Thimble", matchesBrand: true, sameAs: 1 });
    expect(audit.findings[0].id).toBe("firewall");
    expect(audit.findings.map((f) => f.id)).toContain("blank-pages");

    expect(calls.some((c) => c.url.includes("/admin"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/login"))).toBe(false);
    const pageCalls = calls.filter((c) => c.url === `${W}/pricing`);
    expect(pageCalls.map((c) => c.ua)).toEqual([KIOKU_USER_AGENT]);
    expect(calls.filter((c) => c.url === `${W}/`).length).toBe(10);

    expect(events.filter((e) => e.type === "step").map((e) => e.type === "step" && e.step)).toEqual(["home", "robots", "bots", "files", "pages", "score"]);
    const pages = events.filter((e) => e.type === "page");
    expect(pages.at(-1)).toMatchObject({ done: 5, total: 5 });
  });

  it("obeys robots.txt: pages the catch-all rule closes are skipped, not read", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/robots.txt`] = () => ({ status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /\n" });
    const { fetch, calls } = site(routes);
    const result = await runAudit(input, () => {}, { fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.pages.map((p) => [new URL(p.url).pathname, p.verdict])).toEqual([
      ["/", "skipped"],
      ["/docs/getting-started", "skipped"],
    ]);
    expect(result.audit.pages[0].note).toMatch(/robots\.txt/);
    expect(calls.filter((c) => c.ua === KIOKU_USER_AGENT).map((c) => new URL(c.url).pathname)).toEqual(["/robots.txt"]);
    expect(result.audit.findings[0].id).toBe("robots-blocked");
  });

  it("can't confirm bot refusals when the site turns Kioku's own crawler away too", async () => {
    const routes = thimbleRoutes();
    const check = html("<p>Just a moment...</p>", "<title>Just a moment...</title>");
    routes[`${W}/`] = (ua) => (ua.includes("Googlebot") ? { status: 200, body: HOME } : { status: 403, body: check, headers: { "cf-mitigated": "challenge" } });
    const { fetch, calls } = site(routes);
    const result = await runAudit(input, () => {}, { fetch });
    if (!result.ok) throw new Error(result.message);
    const access = Object.fromEntries(result.audit.bots.map((b) => [b.token, b.access]));
    expect(access).toMatchObject({ "OAI-SearchBot": "unconfirmed", PerplexityBot: "unconfirmed", GPTBot: "robots", Googlebot: "allowed" });
    expect(result.audit.pages).toHaveLength(1);
    expect(result.audit.pages[0]).toMatchObject({ verdict: "failed", status: 403 });
    expect(calls.some((c) => /\/(pricing|docs|blog|compare)/.test(c.url))).toBe(false);
  });

  it("counts a bot check served with a 200 as a refusal, not a blank page", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/pricing`] = () => ({ status: 200, body: html("<p>Checking your browser</p>", "<title>Just a moment...</title>") });
    const result = await runAudit(input, () => {}, { fetch: site(routes).fetch });
    expect(result.ok && result.audit.pages.find((p) => p.url.endsWith("/pricing"))).toMatchObject({ verdict: "failed", note: "Showed a bot check instead of the page" });
  });

  it("says when the site refuses a normal browser too", async () => {
    const { fetch } = site({ "https://thimble.studio/": () => ({ status: 403, body: "Forbidden" }) });
    const result = await runAudit(input, () => {}, { fetch });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toMatch(/403 to a normal browser/);
  });

  it("says when the site can't be reached at all", async () => {
    const { fetch } = site({ "https://thimble.studio/": () => "down", "http://thimble.studio/": () => "down" });
    const result = await runAudit(input, () => {}, { fetch });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toMatch(/couldn't open thimble\.studio/);
  });

  it("falls back to http when https doesn't answer", async () => {
    const { fetch } = site({ "https://thimble.studio/": () => "down", "http://thimble.studio/": () => ({ status: 200, body: HOME }) });
    const result = await runAudit(input, () => {}, { fetch });
    expect(result.ok && result.audit.homepage).toBe("http://thimble.studio/");
  });

  it("reads a valid llms.txt and ignores a web page served in its place", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/llms.txt`] = () => ({ status: 200, type: "text/plain", body: "# Thimble\n> Tracker\n## Docs\n- [Start](https://thimble.studio/docs)\n" });
    routes[`${W}/llms-full.txt`] = () => ({ status: 200, type: "text/html", body: HOME });
    const result = await runAudit(input, () => {}, { fetch: site(routes).fetch });
    expect(result.ok && result.audit.llmsTxt).toEqual({ found: true, wellFormed: true, title: "Thimble", links: 1, full: false });
  });

  it("follows a sitemap index to its first sitemap and notices one robots.txt doesn't list", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/robots.txt`] = () => ({ status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /admin\n" });
    routes[`${W}/sitemap.xml`] = () => ({ status: 200, type: "application/xml", body: `<sitemapindex><sitemap><loc>${W}/sitemap-pages.xml</loc></sitemap></sitemapindex>` });
    routes[`${W}/sitemap-pages.xml`] = () => ({ status: 200, type: "application/xml", body: `<urlset><url><loc>${W}/features</loc></url></urlset>` });
    routes[`${W}/features`] = () => ({ status: 200, body: READABLE("Features", "SoftwareApplication") });
    const result = await runAudit(input, () => {}, { fetch: site(routes).fetch });
    expect(result.ok && result.audit.sitemap).toMatchObject({ found: true, listed: false, pages: 1, url: `${W}/sitemap.xml` });
    expect(result.ok && result.audit.pages.some((p) => p.url === `${W}/features`)).toBe(true);
  });

  it("records pages that fail or aren't web pages", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/docs/getting-started`] = () => ({ status: 404, body: "gone" });
    routes[`${W}/pricing`] = () => ({ status: 200, type: "application/pdf", body: "%PDF" });
    const result = await runAudit(input, () => {}, { fetch: site(routes).fetch });
    if (!result.ok) throw new Error(result.message);
    const by = Object.fromEntries(result.audit.pages.map((p) => [new URL(p.url).pathname, p]));
    expect(by["/docs/getting-started"]).toMatchObject({ verdict: "failed", status: 404, note: "Answered 404" });
    expect(by["/pricing"]).toMatchObject({ verdict: "failed", note: "Not a web page (application/pdf)" });
  });

  it("reads noindex from the X-Robots-Tag header", async () => {
    const routes = thimbleRoutes();
    routes[`${W}/compare/quiltboard`] = () => ({ status: 200, body: READABLE("Compare"), headers: { "x-robots-tag": "noindex" } });
    const result = await runAudit(input, () => {}, { fetch: site(routes).fetch });
    expect(result.ok && result.audit.pages.find((p) => p.url.endsWith("/compare/quiltboard"))?.noindex).toBe(true);
  });

  it("stops starting pages when it's nearly out of time and says so", async () => {
    let clock = 0;
    const { fetch } = site(thimbleRoutes());
    const slow: Fetcher = async (url, options) => {
      clock += 3_000;
      return fetch(url, options);
    };
    const result = await runAudit(input, () => {}, { fetch: slow, now: () => clock, budgetMs: 50_000, pageConcurrency: 1 });
    if (!result.ok) throw new Error(result.message);
    const skipped = result.audit.pages.filter((p) => p.verdict === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].note).toMatch(/time/);
  });
});
