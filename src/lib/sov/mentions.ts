import type { Mention, Sentiment } from "@/lib/sov/types";

const GENERIC_SUFFIXES = new Set([
  "inc",
  "inc.",
  "llc",
  "ltd",
  "ltd.",
  "co",
  "co.",
  "corp",
  "corp.",
  "app",
  "hq",
  "software",
  "platform",
  "crm",
  "erp",
  "cms",
  "suite",
]);

const MIN_ALIAS_LENGTH = 3;

export function brandAliases(name: string, category?: string): string[] {
  const full = name.trim().replace(/\s+/g, " ");
  if (!full) return [];
  const aliases = [full];
  const words = full.split(" ");
  if (words.length > 1) {
    const last = words[words.length - 1].toLowerCase();
    const categoryWords = new Set(
      (category ?? "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
    if (GENERIC_SUFFIXES.has(last) || categoryWords.has(last)) {
      const short = words.slice(0, -1).join(" ");
      if (short.length >= MIN_ALIAS_LENGTH) aliases.push(short);
    }
  }
  return aliases;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Occurrence {
  brand: string;
  start: number;
  end: number;
}

export function findMentions(text: string, brands: string[], category?: string): Mention[] {
  const fullNames = new Set(brands.map((b) => b.trim().toLowerCase()));
  const matchers: { brand: string; pattern: RegExp }[] = [];
  for (const brand of brands) {
    for (const alias of brandAliases(brand, category)) {
      const isOwnName = alias.toLowerCase() === brand.trim().toLowerCase();
      if (!isOwnName && fullNames.has(alias.toLowerCase())) continue;
      matchers.push({
        brand,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(alias)}(?![\\p{L}\\p{N}_])`, "giu"),
      });
    }
  }

  const occurrences: Occurrence[] = [];
  for (const { brand, pattern } of matchers) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      occurrences.push({ brand, start, end: start + match[0].length });
    }
  }
  occurrences.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const firstOffset = new Map<string, number>();
  let lastEnd = -1;
  for (const occ of occurrences) {
    if (occ.start < lastEnd) continue;
    lastEnd = occ.end;
    if (!firstOffset.has(occ.brand)) firstOffset.set(occ.brand, occ.start);
  }

  return [...firstOffset.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([brand, offset], index) => {
      const snippet = snippetAt(text, offset);
      return { brand, rank: index + 1, offset, snippet, sentiment: classifySentiment(snippet) };
    });
}

const MAX_SNIPPET = 240;

export function snippetAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndIndex = text.indexOf("\n", offset);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  let line = text.slice(lineStart, lineEnd);
  let local = offset - lineStart;

  if (line.length > MAX_SNIPPET) {
    const before = line.slice(0, local);
    const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
    const from = sentenceStart === -1 ? 0 : sentenceStart + 2;
    const after = line.slice(local).search(/[.!?](\s|$)/);
    const to = after === -1 ? line.length : local + after + 1;
    line = line.slice(from, Math.min(to, from + MAX_SNIPPET));
    local -= from;
  }

  return line
    .replace(/^\s*(?:#{1,6}\s+|\d+[.)]\s+|[-*•+]\s+)/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const POSITIVE_TERMS = [
  "best",
  "great",
  "excellent",
  "outstanding",
  "intuitive",
  "powerful",
  "popular",
  "loved",
  "love",
  "favorite",
  "favourite",
  "ideal",
  "leading",
  "recommended",
  "standout",
  "easy",
  "user-friendly",
  "robust",
  "reliable",
  "affordable",
  "flexible",
  "strong",
  "solid",
  "impressive",
  "seamless",
  "generous",
  "praised",
];

const NEGATIVE_TERMS = [
  "expensive",
  "pricey",
  "costly",
  "clunky",
  "limited",
  "lacks",
  "lacking",
  "steep learning curve",
  "learning curve",
  "outdated",
  "dated",
  "complex",
  "complicated",
  "slow",
  "buggy",
  "confusing",
  "overkill",
  "drawback",
  "downside",
  "frustrating",
  "cluttered",
  "rigid",
  "weak",
  "poor",
  "difficult",
];

const NEGATORS = new Set(["not", "no", "never", "hardly", "isn't", "isnt", "aren't", "less"]);

function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
}

const POSITIVE_PATTERNS = POSITIVE_TERMS.map(termPattern);
const NEGATIVE_PATTERNS = NEGATIVE_TERMS.map(termPattern);

export function negativeTermsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return NEGATIVE_TERMS.filter((term) => new RegExp(termPattern(term).source, "iu").test(lower));
}

export function classifySentiment(text: string): Sentiment {
  const lower = text.toLowerCase();
  let score = 0;

  for (const pattern of POSITIVE_PATTERNS) {
    for (const match of lower.matchAll(pattern)) {
      const preceding = lower
        .slice(0, match.index)
        .split(/[^\p{L}']+/u)
        .filter(Boolean)
        .slice(-3);
      score += preceding.some((word) => NEGATORS.has(word)) ? -1 : 1;
    }
  }
  for (const pattern of NEGATIVE_PATTERNS) {
    score -= [...lower.matchAll(pattern)].length;
  }

  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}
