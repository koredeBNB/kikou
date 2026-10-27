import { describe, expect, it } from "vitest";
import { isPlainText, parseLlmsTxt, parseSitemap } from "@/lib/audit/files";

describe("parseLlmsTxt", () => {
  it("reads the title, summary, sections and links of a well-formed file", () => {
    const facts = parseLlmsTxt(`# Thimble

> Project tracker for small design studios.

Some extra notes.

## Docs

- [Getting started](https://thimble.studio/docs/start): set up in five minutes
- [Pricing](https://thimble.studio/pricing)

## Optional

- [Blog](https://thimble.studio/blog)
`);
    expect(facts).toEqual({ title: "Thimble", summary: true, sections: 2, links: 3 });
  });

  it("notices a file without a title or links", () => {
    expect(parseLlmsTxt("Welcome to our site!\nWe make tools.")).toEqual({ title: undefined, summary: false, sections: 0, links: 0 });
  });

  it("only takes a title from the first heading line", () => {
    expect(parseLlmsTxt("\n\n# Acme\n## Section\n# Second").title).toBe("Acme");
  });
});

describe("isPlainText", () => {
  it("rejects a web page served in place of a text file", () => {
    expect(isPlainText("text/html", "<!DOCTYPE html><html>")).toBe(false);
    expect(isPlainText("text/plain", "  <html><body>404</body></html>")).toBe(false);
    expect(isPlainText("text/plain", "# Acme")).toBe(true);
    expect(isPlainText("text/markdown", "# Acme")).toBe(true);
    expect(isPlainText("", "# Acme")).toBe(true);
  });
});

describe("parseSitemap", () => {
  it("reads page URLs from a urlset", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://thimble.studio/</loc></url>
  <url><loc> https://thimble.studio/pricing?plan=a&amp;b=1 </loc><lastmod>2026-01-01</lastmod></url>
  <url><loc><![CDATA[https://thimble.studio/docs]]></loc></url>
</urlset>`;
    expect(parseSitemap(xml)).toEqual({
      pages: ["https://thimble.studio/", "https://thimble.studio/pricing?plan=a&b=1", "https://thimble.studio/docs"],
      sitemaps: [],
    });
  });

  it("reads child sitemaps from a sitemap index", () => {
    const xml = `<sitemapindex><sitemap><loc>https://thimble.studio/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://thimble.studio/sitemap-blog.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({ pages: [], sitemaps: ["https://thimble.studio/sitemap-pages.xml", "https://thimble.studio/sitemap-blog.xml"] });
  });

  it("returns nothing for something that isn't a sitemap", () => {
    expect(parseSitemap("<html><body>Not found</body></html>")).toEqual({ pages: [], sitemaps: [] });
  });
});
