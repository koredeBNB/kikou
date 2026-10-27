/** A robots.txt reader following RFC 9309, with the leniency Google's parser shows for common typos. */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
  /** 1-based line in the file. */
  line: number;
}

export interface RobotsGroup {
  /** Lower-case product tokens, or "*". */
  agents: string[];
  rules: RobotsRule[];
}

export interface RobotsFile {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export interface RobotsVerdict {
  allowed: boolean;
  /** Whether a group names the bot, only the catch-all applies, or no group applies at all. */
  group: "named" | "wildcard" | "none";
  rule?: RobotsRule;
}

export type RobotsState =
  | { kind: "found"; status: number; file: RobotsFile }
  | { kind: "missing"; status: number; html?: boolean }
  | { kind: "unreachable"; status: number | null };

const USER_AGENT_KEYS = new Set(["user-agent", "useragent", "user agent"]);
const ALLOW_KEYS = new Set(["allow"]);
const DISALLOW_KEYS = new Set(["disallow", "dissallow", "dissalow", "disalow", "diasllow", "disallaw"]);

/** "Googlebot/2.1" → "googlebot". Google matches on the leading letters, hyphens and underscores. */
function productToken(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("*")) return "*";
  return trimmed.match(/^[a-z_-]+/)?.[0] ?? "";
}

export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let inAgents = false;

  text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .forEach((raw, index) => {
      const line = raw.replace(/#.*$/, "").trim();
      const colon = line.indexOf(":");
      if (colon < 0) return;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();

      if (USER_AGENT_KEYS.has(key)) {
        const token = productToken(value);
        if (!inAgents || !current) {
          current = { agents: [], rules: [] };
          groups.push(current);
        }
        if (token && !current.agents.includes(token)) current.agents.push(token);
        inAgents = true;
        return;
      }
      if (key === "sitemap") {
        if (/^https?:\/\//i.test(value)) sitemaps.push(value);
        return;
      }
      const allow = ALLOW_KEYS.has(key);
      if (!allow && !DISALLOW_KEYS.has(key)) return;
      inAgents = false;
      if (!current || !value) return;
      const pattern = value.startsWith("/") || value.startsWith("*") ? value : `/${value}`;
      current.rules.push({ allow, pattern, line: index + 1 });
    });

  return { groups: groups.filter((g) => g.agents.length > 0), sitemaps };
}

function normalize(path: string): string {
  try {
    return encodeURI(decodeURI(path));
  } catch {
    return path;
  }
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = normalize(body)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** Whether `token` may fetch `path` (path plus query). The most specific rule wins, and allow wins a tie. */
export function robotsVerdict(robots: RobotsFile, token: string, path: string): RobotsVerdict {
  const target = normalize(path || "/");
  if (target === "/robots.txt") return { allowed: true, group: "none" };
  const name = productToken(token);
  const named = robots.groups.filter((g) => g.agents.includes(name));
  const applicable = named.length ? named : robots.groups.filter((g) => g.agents.includes("*"));
  if (applicable.length === 0) return { allowed: true, group: "none" };
  const group = named.length ? "named" : "wildcard";

  let best: RobotsRule | undefined;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, target)) continue;
    const length = normalize(rule.pattern).length;
    const bestLength = best ? normalize(best.pattern).length : -1;
    if (length > bestLength || (length === bestLength && rule.allow && !best?.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, group, rule: best };
}

/**
 * RFC 9309: a missing file (any 4xx) means no rules. A server error, a rate limit or no answer at all means
 * crawlers should stay out entirely until it loads again.
 */
export function robotsFromResponse(status: number | null, body: string | null): RobotsState {
  if (status === null || status === 429 || status >= 500) return { kind: "unreachable", status };
  if (status >= 400) return { kind: "missing", status };
  const text = body ?? "";
  if (/^\s*(?:<!doctype html|<html|<head|<body)/i.test(text)) return { kind: "missing", status, html: true };
  return { kind: "found", status, file: parseRobots(text) };
}

/** The verdict a crawler would reach for `path`, whatever state the file is in. */
export function verdictFor(state: RobotsState, token: string, path: string): RobotsVerdict {
  if (state.kind === "found") return robotsVerdict(state.file, token, path);
  if (state.kind === "missing") return { allowed: true, group: "none" };
  return { allowed: false, group: "none" };
}
