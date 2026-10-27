import { describe, expect, it } from "vitest";
import { analyzeHtml, robotsDirectives } from "@/lib/audit/html";

const PAGE = "https://thimble.studio/";

const SERVER_RENDERED = `<!doctype html>
<html lang="en">
<head>
  <title> Thimble – project tracker for design studios </title>
  <meta name="description" content="Plan, track and ship client work.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Organization","name":"Thimble","url":"https://thimble.studio","logo":{"@type":"ImageObject","url":"https://thimble.studio/logo.png"},"sameAs":["https://x.com/thimble","https://www.linkedin.com/company/thimble"]},
    {"@type":"WebSite","name":"Thimble","publisher":{"@id":"#org"}}
  ]}
  </script>
  <script type="application/ld+json">{"@type": ["SoftwareApplication"], "offers": {"@type": "Offer", "price": "12"}}</script>
  <script type="application/ld+json">{ "@type": "FAQPage", broken }</script>
  <style>.hero { color: red }</style>
</head>
<body>
  <header><a href="/pricing">Pricing</a> <a href="/compare/quiltboard?ref=nav#top">Compare</a> <a href="https://elsewhere.com/x">Partner</a> <a href="/brochure.pdf">Brochure</a> <a href="/index.md">Markdown</a> <a href="mailto:hi@thimble.studio">Mail</a></header>
  <h1>Ship client work without the chaos</h1>
  <p>Thimble keeps briefs, feedback and deadlines in one calm place.</p><p>Studios of two to twenty people use it daily.</p>
  <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Thimble Pro</span></div>
  <script>window.__DATA__ = { lots: "of words that should not count at all" }</script>
  <noscript>Some fallback text</noscript>
</body>
</html>`;

describe("analyzeHtml", () => {
  const facts = analyzeHtml(SERVER_RENDERED, PAGE);

  it("reads the title, description, headings, language and canonical", () => {
    expect(facts.title).toBe("Thimble – project tracker for design studios");
    expect(facts.description).toBe("Plan, track and ship client work.");
    expect(facts.h1Count).toBe(1);
    expect(facts.lang).toBe("en");
    expect(facts.canonical).toBe("https://thimble.studio/");
  });

  it("counts only the words a crawler sees, not scripts, styles or noscript fallbacks", () => {
    expect(facts.words).toBe(33);
    expect(facts.appShell).toBeUndefined();
  });

  it("collects structured data types, including nested and @graph nodes, and counts blocks that don't parse", () => {
    expect(facts.schemaTypes).toEqual(expect.arrayContaining(["Organization", "ImageObject", "WebSite", "SoftwareApplication", "Offer", "Product"]));
    expect(facts.invalidJsonLd).toBe(1);
  });

  it("pulls out the Organization's details", () => {
    expect(facts.organization).toEqual({ name: "Thimble", url: "https://thimble.studio", logo: true, sameAs: 2 });
  });

  it("lists same-site page links without fragments, queries or files", () => {
    expect(facts.links).toEqual(["https://thimble.studio/pricing", "https://thimble.studio/compare/quiltboard"]);
  });

  it("reads robots meta directives", () => {
    const noindex = analyzeHtml('<html><head><meta name="ROBOTS" content="NoIndex, nosnippet"></head><body>Hi</body></html>', PAGE);
    expect(noindex.robots).toEqual(["noindex", "nosnippet"]);
  });

  it("spots an app shell that only JavaScript fills in", () => {
    const shell = analyzeHtml(
      '<html><head><title>Thimble</title></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script></body></html>',
      PAGE,
    );
    expect(shell.words).toBe(0);
    expect(shell.appShell).toMatch(/empty #root/i);
  });

  it("spots an enable-JavaScript message on a near-empty page", () => {
    const shell = analyzeHtml("<html><body><div class=\"wrap\">Loading…</div><noscript>Please enable JavaScript.</noscript></body></html>", PAGE);
    expect(shell.appShell).toMatch(/enable javascript/i);
  });

  it("doesn't call a server-rendered Next.js page an app shell", () => {
    const next = analyzeHtml(`<html><body><div id="__next"><main><h1>Pricing</h1><p>${"Plans for every studio size. ".repeat(30)}</p></main></div><script src="/_next/a.js"></script></body></html>`, PAGE);
    expect(next.appShell).toBeUndefined();
    expect(next.words).toBeGreaterThan(100);
  });

  it("counts Chinese and Japanese text, which has no spaces between words", () => {
    const zh = analyzeHtml("<html><body><p>项目管理工具帮助设计工作室按时交付</p></body></html>", PAGE);
    expect(zh.words).toBeGreaterThanOrEqual(8);
  });

  it("copes with an empty document", () => {
    const empty = analyzeHtml("", PAGE);
    expect(empty).toMatchObject({ words: 0, h1Count: 0, schemaTypes: [], invalidJsonLd: 0, organization: null, links: [] });
  });
});

describe("robotsDirectives", () => {
  it("reads X-Robots-Tag directives that apply to every crawler", () => {
    expect(robotsDirectives("noindex, nofollow")).toEqual(["noindex", "nofollow"]);
    expect(robotsDirectives("max-snippet:0")).toEqual(["max-snippet:0"]);
  });

  it("skips directives aimed at one named crawler", () => {
    expect(robotsDirectives("googlebot: noindex, otherbot: nofollow")).toEqual([]);
    expect(robotsDirectives(undefined)).toEqual([]);
  });
});
