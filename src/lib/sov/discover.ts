import { brandAliases } from "@/lib/sov/mentions";

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•+])\s+(.+)$/;
const BOLD_LEAD = /^(?:\*\*|__)(.+?)(?:\*\*|__)/;
const PLAIN_LEAD = /^(.+?)(?::|\s[–—-]\s|\s\(|,)/;

const GENERIC_FIRST_WORDS = new Set([
  "best",
  "top",
  "why",
  "how",
  "what",
  "when",
  "pros",
  "cons",
  "key",
  "overall",
  "bottom",
  "pricing",
  "price",
  "free",
  "paid",
  "note",
  "notes",
  "tip",
  "tips",
  "step",
  "option",
  "options",
  "use",
  "consider",
  "look",
  "choose",
  "ease",
  "great",
  "good",
  "more",
  "other",
  "also",
  "if",
  "the",
  "summary",
  "verdict",
  "conclusion",
  "features",
  "integrations",
  "support",
  "scalability",
  "cost",
  "budget",
  "recommendation",
  "recommendations",
  "considerations",
  "alternatives",
  "honorable",
  "honourable",
]);

function candidateFrom(item: string): string | null {
  const bold = item.match(BOLD_LEAD);
  const raw = bold ? bold[1] : item.match(PLAIN_LEAD)?.[1];
  if (!raw) return null;
  const name = raw.replace(/[:.;,]+$/, "").trim();
  const words = name.split(/\s+/);
  if (name.length < 2 || name.length > 40 || words.length > 4) return null;
  if (!/^[\p{Lu}\p{N}]/u.test(name)) return null;
  if (/^\d+$/.test(name)) return null;
  if (GENERIC_FIRST_WORDS.has(words[0].toLowerCase())) return null;
  return name;
}

export interface DiscoverOptions {
  /** Minimum number of distinct answers a name must appear in. */
  minAnswers?: number;
}

/** Finds likely brand names from list items in answers, excluding brands already tracked. */
export function discoverBrands(texts: string[], known: string[], options: DiscoverOptions = {}): string[] {
  const minAnswers = options.minAnswers ?? 2;
  const knownKeys = new Set(known.flatMap((name) => brandAliases(name)).map((n) => n.toLowerCase()));
  const found = new Map<string, { name: string; answers: number; firstSeen: number }>();
  let order = 0;

  for (const text of texts) {
    const inThisAnswer = new Set<string>();
    for (const line of text.split("\n")) {
      const item = line.match(LIST_ITEM)?.[1];
      if (!item) continue;
      const name = candidateFrom(item.trim());
      if (!name) continue;
      const key = name.toLowerCase();
      if (knownKeys.has(key) || inThisAnswer.has(key)) continue;
      inThisAnswer.add(key);
      const entry = found.get(key);
      if (entry) entry.answers += 1;
      else found.set(key, { name, answers: 1, firstSeen: order++ });
    }
  }

  return [...found.values()]
    .filter((entry) => entry.answers >= minAnswers)
    .sort((a, b) => b.answers - a.answers || a.firstSeen - b.firstSeen)
    .map((entry) => entry.name);
}
