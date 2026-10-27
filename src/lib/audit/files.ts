/** Readers for the discovery files: llms.txt (llmstxt.org) and XML sitemaps. */

export interface LlmsTxtShape {
  /** The H1 the format starts with. */
  title?: string;
  /** A blockquote summary. */
  summary: boolean;
  /** H2 sections of links. */
  sections: number;
  links: number;
}

export function parseLlmsTxt(text: string): LlmsTxtShape {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((line) => line.trim());
  const first = lines.find((line) => line.length > 0) ?? "";
  const title = first.match(/^#\s+(.+)$/)?.[1]?.trim();
  return {
    title,
    summary: lines.some((line) => line.startsWith(">")),
    sections: lines.filter((line) => /^##\s+\S/.test(line)).length,
    links: [...text.matchAll(/\[[^\]]*\]\((?:https?:\/\/|\/)[^)\s]*\)/g)].length,
  };
}

/** False for a web page served in place of a text file, which many sites do instead of a 404. */
export function isPlainText(contentType: string, body: string): boolean {
  if (contentType.includes("html")) return false;
  return !/^\s*<(?:!doctype|html|head|body)/i.test(body);
}

const MAX_LOCS = 5_000;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)) {
    locs.push(decodeXml(match[1]));
    if (locs.length >= MAX_LOCS) break;
  }
  if (/<sitemapindex[\s>]/i.test(xml)) return { pages: [], sitemaps: locs };
  if (/<urlset[\s>]/i.test(xml)) return { pages: locs, sitemaps: [] };
  return { pages: [], sitemaps: [] };
}
