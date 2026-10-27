import { parse, type HTMLElement } from "node-html-parser";

/** What a crawler that doesn't run JavaScript can read in a page's raw HTML. */
export interface HtmlFacts {
  title?: string;
  description?: string;
  h1Count: number;
  lang?: string;
  canonical?: string;
  /** Lower-case directives from robots meta tags, e.g. "noindex". */
  robots: string[];
  /** Visible words in the body, with scripts, styles and noscript fallbacks left out. */
  words: number;
  /** Why the page looks like an empty shell that JavaScript fills in, when it does. */
  appShell?: string;
  /** schema.org types from JSON-LD and microdata, without repeats. */
  schemaTypes: string[];
  /** JSON-LD blocks that don't parse. */
  invalidJsonLd: number;
  organization: OrganizationNode | null;
  /** Same-site page links, without fragments or queries. */
  links: string[];
}

export interface OrganizationNode {
  name?: string;
  url?: string;
  logo: boolean;
  sameAs: number;
}

const REMOVED = "script, style, noscript, template, svg, iframe, object, head";
const MOUNT_POINTS = ["root", "app", "__next", "__nuxt", "___gatsby", "svelte", "main-app", "application"];
const ENABLE_JS = /enable javascript|javascript (?:is )?(?:required|disabled|turned off)|requires javascript|needs? javascript/i;
const ORG_TYPES = new Set(["Corporation", "LocalBusiness", "OnlineBusiness", "OnlineStore", "NGO", "Store", "ProfessionalService", "Airline", "Consortium"]);
const FILE_EXTENSION = /\.(?:pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|gz|mp4|mp3|mov|webm|css|js|mjs|json|xml|txt|md|markdown|rss|atom|woff2?|ttf|dmg|exe|apk)$/i;
const SHELL_WORDS = 150;
const MAX_LINKS = 400;
const MAX_NODES = 2_000;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.replace(CJK, " ").match(WORD)?.length ?? 0;
  return rest + Math.ceil(cjk / 2);
}

const clean = (value: string | undefined | null) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
};

function absolute(href: string | undefined, base: string): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

function schemaName(type: unknown): string | null {
  if (typeof type !== "string") return null;
  const name = type.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, "");
  return /^[A-Za-z][\w]*$/.test(name) ? name : null;
}

const isOrgType = (type: string) => type.endsWith("Organization") || ORG_TYPES.has(type);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function organizationOf(node: Json): OrganizationNode {
  const logo = node.logo;
  const sameAs = node.sameAs;
  return {
    name: typeof node.name === "string" ? clean(node.name) : undefined,
    url: typeof node.url === "string" ? node.url.trim() : undefined,
    logo: typeof logo === "string" ? logo.trim().length > 0 : isObject(logo) ? typeof logo.url === "string" || typeof logo.contentUrl === "string" : false,
    sameAs: typeof sameAs === "string" ? 1 : Array.isArray(sameAs) ? sameAs.filter((s) => typeof s === "string").length : 0,
  };
}

/** Walks every object in a JSON-LD document, nested ones and @graph members included. */
function walkJsonLd(value: unknown, types: Set<string>, orgs: OrganizationNode[]) {
  const stack: unknown[] = [value];
  let seen = 0;
  while (stack.length && seen++ < MAX_NODES) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isObject(node)) continue;
    const declared = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    const names = declared.map(schemaName).filter((t): t is string => t !== null);
    for (const name of names) types.add(name);
    if (names.some(isOrgType)) orgs.push(organizationOf(node));
    for (const child of Object.values(node)) if (typeof child === "object" && child !== null) stack.push(child);
  }
}

function parseJsonLd(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^<!--|-->$/g, "")
    .replace(/^\s*(?:\/\/\s*)?<!\[CDATA\[|(?:\/\/\s*)?\]\]>\s*$/g, "")
    .trim();
  return JSON.parse(text);
}

/** Directives in an X-Robots-Tag header that apply to every crawler. Ones prefixed with a crawler's name are skipped. */
export function robotsDirectives(header: string | undefined): string[] {
  if (!header) return [];
  const directives: string[] = [];
  for (const part of header.toLowerCase().split(",")) {
    const value = part.trim();
    if (!value) continue;
    const prefix = value.match(/^([a-z_-]+)\s*:/)?.[1];
    if (prefix && !["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"].includes(prefix)) continue;
    directives.push(value.replace(/\s+/g, ""));
  }
  return directives;
}

function shellReason(root: HTMLElement, words: number, noscript: string, scripts: number): string | undefined {
  if (words >= SHELL_WORDS) return undefined;
  for (const id of MOUNT_POINTS) {
    const mount = root.querySelector(`#${id}`);
    if (mount && countWords(mount.structuredText) === 0) return `An empty #${id} element that JavaScript fills in`;
  }
  const angular = root.querySelector("app-root");
  if (angular && countWords(angular.structuredText) === 0) return "An empty <app-root> element that JavaScript fills in";
  if (ENABLE_JS.test(noscript)) return "A “please enable JavaScript” message in place of content";
  if (words < 50 && scripts >= 3) return `Almost no text, and ${scripts} scripts`;
  return undefined;
}

export function analyzeHtml(html: string, pageUrl: string): HtmlFacts {
  const root = parse(html, { comment: false, blockTextElements: { script: true, noscript: true, style: true, pre: true } });
  const metas = root.querySelectorAll("meta");
  const meta = (name: string) => metas.filter((m) => m.getAttribute("name")?.trim().toLowerCase() === name).map((m) => m.getAttribute("content") ?? "");
  const canonicalHref = root.querySelectorAll("link").find((l) => (l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.getAttribute("href");
  const robots = meta("robots").flatMap((content) => robotsDirectives(content));

  const types = new Set<string>();
  const orgs: OrganizationNode[] = [];
  let invalidJsonLd = 0;
  const scripts = root.querySelectorAll("script");
  for (const script of scripts) {
    if (!(script.getAttribute("type") ?? "").toLowerCase().includes("ld+json")) continue;
    try {
      walkJsonLd(parseJsonLd(script.rawText), types, orgs);
    } catch {
      invalidJsonLd++;
    }
  }
  for (const element of root.querySelectorAll("[itemtype]")) {
    for (const value of (element.getAttribute("itemtype") ?? "").split(/\s+/)) {
      const name = schemaName(value.split("/").pop());
      if (name) types.add(name);
    }
  }

  const page = absolute(pageUrl, pageUrl);
  const links: string[] = [];
  const seen = new Set<string>();
  for (const anchor of root.querySelectorAll("a[href]")) {
    const url = absolute(anchor.getAttribute("href"), pageUrl);
    if (!url || !page || bareHost(url.hostname) !== bareHost(page.hostname) || FILE_EXTENSION.test(url.pathname)) continue;
    url.hash = "";
    url.search = "";
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
    if (links.length >= MAX_LINKS) break;
  }

  const executable = scripts.filter((s) => /^(?:|text\/javascript|application\/javascript|module)$/i.test((s.getAttribute("type") ?? "").trim())).length;
  const noscript = root.querySelectorAll("noscript").map((n) => n.rawText).join(" ");
  const h1Count = root.querySelectorAll("h1").length;
  const title = clean(root.querySelector("title")?.text);
  const lang = clean(root.querySelector("html")?.getAttribute("lang"));
  for (const node of root.querySelectorAll(REMOVED)) node.remove();
  const body = root.querySelector("body") ?? root;
  const words = countWords(body.structuredText);

  return {
    title,
    description: clean(meta("description")[0]),
    h1Count,
    lang,
    canonical: absolute(canonicalHref, pageUrl)?.toString(),
    robots,
    words,
    appShell: shellReason(root, words, noscript, executable),
    schemaTypes: [...types],
    invalidJsonLd,
    organization: orgs.find((o) => o.name) ?? orgs[0] ?? null,
    links,
  };
}
