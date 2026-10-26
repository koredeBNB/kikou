import { brandAliases } from "@/lib/sov/mentions";

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•+])\s+(.+)$/;
const BOLD_LEAD = /^(?:\*\*|__)(.+?)(?:\*\*|__)/;
const PLAIN_LEAD = /^(.+?)(?::|\s[–—-]\s|\s\(|,)/;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const TRAILING_PUNCTUATION = /[:.;,]+$/;
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)$/;
/** "Privacy-first", "Self-hosted": a capitalised word joined to a lower-case descriptor. */
const DESCRIPTOR = /^\p{Lu}\p{Ll}+[-\u2010\u2011]\p{Ll}+$/u;

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

/** Criteria that answers use as headings. A name made only of these (and connectors) isn't a brand. */
const GENERIC_TERMS = new Set([
  ...GENERIC_FIRST_WORDS,
  ..."of and the & for to in on with a an vs".split(" "),
  ...[
    "risk risks tokenomics competition competitors regulation regulations regulatory legal liquidity volatility",
    "security safety fees fee costs adoption utility ecosystem community roadmap team diversification custody",
    "self-custody staking yield yields returns rewards speed reliability reputation privacy compliance",
    "transparency partnerships interoperability governance valuation market cap demand supply development",
    "insurance reviews ratings onboarding documentation usability user users experience interface design",
    "customization flexibility accessibility availability compatibility control convenience value quality",
    "research education history track record growth momentum innovation technology infrastructure network",
    "effects chain chains multi-chain cross-chain assets asset coverage backup recovery seed phrase hardware",
    "software mobile desktop browser extension extensions wallet wallets exchange exchanges account accounts",
    "management tools analytics reporting automation customer service setup integration limits limitations",
    "drawbacks downsides benefits advantages strengths weaknesses caveats warnings important final thoughts",
    "takeaway takeaways next steps quick comparison criteria factors tax taxes swaps trading bridging defi",
    "blockchain crypto cryptocurrency token tokens coin coins performance use cases",
  ]
    .join(" ")
    .split(" "),
]);

const isGenericPhrase = (name: string) =>
  name
    .toLowerCase()
    .split(/\s+/)
    .every((word) => GENERIC_TERMS.has(word.replace(/[^\p{L}\p{N}&-]/gu, "")));

function candidateFrom(item: string): string | null {
  const text = item.replace(MARKDOWN_LINK, "$1");
  const bold = text.match(BOLD_LEAD);
  const raw = bold ? bold[1] : text.match(PLAIN_LEAD)?.[1];
  if (!raw) return null;
  const name = raw.replace(TRAILING_PUNCTUATION, "").replace(TRAILING_PARENTHETICAL, "").replace(TRAILING_PUNCTUATION, "").trim();
  const words = name.split(/\s+/);
  if (name.length < 2 || name.length > 40 || words.length > 4) return null;
  if (!/^[\p{Lu}\p{N}]/u.test(name)) return null;
  if (/^\d+$/.test(name) || DESCRIPTOR.test(name)) return null;
  if (GENERIC_FIRST_WORDS.has(words[0].toLowerCase()) || isGenericPhrase(name)) return null;
  return name;
}

export interface DiscoverOptions {
  /** Minimum number of distinct answers a name must appear in. */
  minAnswers?: number;
  /** Lets "Fathom Analytics" count as "Fathom" in a web analytics check. */
  category?: string;
}

interface Found {
  /** Spellings seen, with the number of answers each first appeared in. */
  names: Map<string, number>;
  answers: number;
  firstSeen: number;
}

const displayName = (names: Map<string, number>) => [...names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];

/** Finds likely brand names from list items in answers, excluding brands already tracked. */
export function discoverBrands(texts: string[], known: string[], options: DiscoverOptions = {}): string[] {
  const minAnswers = options.minAnswers ?? 2;
  const keysOf = (name: string) => brandAliases(name, options.category).map((n) => n.toLowerCase());
  const knownKeys = new Set(known.flatMap(keysOf));
  const found = new Map<string, Found>();
  let order = 0;

  for (const text of texts) {
    const inThisAnswer = new Set<Found>();
    for (const line of text.split("\n")) {
      const item = line.match(LIST_ITEM)?.[1];
      if (!item) continue;
      const name = candidateFrom(item.trim());
      if (!name) continue;
      const keys = keysOf(name);
      if (keys.some((key) => knownKeys.has(key))) continue;
      const entry = keys.map((key) => found.get(key)).find(Boolean) ?? { names: new Map(), answers: 0, firstSeen: order++ };
      for (const key of keys) found.set(key, entry);
      if (inThisAnswer.has(entry)) continue;
      inThisAnswer.add(entry);
      entry.answers += 1;
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
    }
  }

  const prose = texts.map((text) => text.replace(LINKS, " "));
  return [...new Set(found.values())]
    .filter((entry) => entry.answers >= minAnswers && !isEverydayWord(displayName(entry.names), entry.answers, prose))
    .sort((a, b) => b.answers - a.answers || a.firstSeen - b.firstSeen)
    .map((entry) => displayName(entry.names));
}

const LINKS = /\bhttps?:\/\/\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\b/gu;

/**
 * Headings like “Fees” or “Liquidity” also show up in lower case all through the prose, which
 * brand names rarely do. Links are removed first, so “metamask.io” doesn't count against MetaMask.
 */
function isEverydayWord(name: string, headingAnswers: number, prose: string[]): boolean {
  const lower = name.toLowerCase();
  if (lower === name) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
  return prose.filter((text) => pattern.test(text)).length >= headingAnswers;
}
