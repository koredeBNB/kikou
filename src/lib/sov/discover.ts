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
  "for",
  "start",
  "whichever",
  "whatever",
  "protect",
  "verify",
  "download",
  "avoid",
  "test",
  "testing",
]);

/** “Ledger or Trezor”, “Protect your seed phrase”: choices and advice, not names. */
const NOT_A_NAME = /\s(?:or|and)\s|\b(?:you|your|yours|my|our|we)\b|\*/i;

/** “Solana NFTs”, “Bitcoin fees”: one side of a brand, not a separate brand. */
const FACET_TAILS = new Set("nft nfts mainnet testnet ecosystem fee fees".split(" "));

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
    "blockchain crypto cryptocurrency token tokens coin coins performance use cases pro evm mainnet testnet",
    "clear signing air-gapping air-gapped verification physical method methods transaction transactions",
    "clarity responsibility official sources only native wrapped period periods unbonding provider nft nfts",
    "supports supported",
  ]
    .join(" ")
    .split(" "),
]);

const isGenericPhrase = (name: string) =>
  name
    .toLowerCase()
    .split(/[\s/]+/)
    .every((word) => GENERIC_TERMS.has(word.replace(/[^\p{L}\p{N}&-]/gu, "")));

/** A list item's lead (the bold or colon-ended start) and what follows it. */
function splitLead(item: string): { raw: string; rest: string; bold: boolean } | null {
  const text = item.replace(MARKDOWN_LINK, "$1");
  const bold = text.match(BOLD_LEAD);
  const lead = bold ?? text.match(PLAIN_LEAD);
  const marked = bold !== null || /^\[[^\]]+\]\(/.test(item);
  return lead ? { raw: lead[1], rest: text.slice(lead[0].length).replace(/^[\s:–—-]+/, ""), bold: marked } : null;
}

function nameFrom(raw: string): string | null {
  const name = raw.replace(TRAILING_PUNCTUATION, "").replace(TRAILING_PARENTHETICAL, "").replace(TRAILING_PUNCTUATION, "").trim();
  const words = name.split(/\s+/);
  if (name.length < 2 || name.length > 40 || words.length > 4) return null;
  if (!/^[\p{Lu}\p{N}]/u.test(name)) return null;
  if (/^\d+$/.test(name) || DESCRIPTOR.test(name)) return null;
  if (GENERIC_FIRST_WORDS.has(words[0].toLowerCase()) || NOT_A_NAME.test(name) || isGenericPhrase(name)) return null;
  if (words.length > 1 && FACET_TAILS.has(words[words.length - 1].toLowerCase())) return null;
  return name;
}

export interface DiscoverOptions {
  /** Minimum number of distinct answers a name must appear in. */
  minAnswers?: number;
  /** Lets "Fathom Analytics" count as "Fathom" in a web analytics check. */
  category?: string;
  /** Tracked brands whose product lines count as them, e.g. "MetaMask Flask" as MetaMask. Defaults to `known`. */
  tracked?: string[];
}

/** A brand found in the answers, with the list item it was first seen in. */
export interface DiscoveredBrand {
  name: string;
  answers: number;
  context: string;
}

interface ListItem {
  /** The name the item leads with, when it looks like one. */
  name: string | null;
  /** What follows the lead, or the whole item when it has none. */
  rest: string;
  hasLead: boolean;
  /** Bold or linked, as brands in a list usually are; plain leads are often details (“Keyless, no seed phrase”). */
  bold: boolean;
  line: string;
  indent: number;
  /** Items in one list at one depth share a block. */
  block: number;
  children: ListItem[];
}

function listItems(text: string): ListItem[] {
  const items: ListItem[] = [];
  const open: ListItem[] = [];
  const blocks = new Map<number, number>();
  let nextBlock = 0;
  const close = (indent: number, inclusive: boolean) => {
    while (open.length && (inclusive ? open.at(-1)!.indent >= indent : open.at(-1)!.indent > indent)) open.pop();
    for (const depth of [...blocks.keys()]) if (inclusive ? depth >= indent : depth > indent) blocks.delete(depth);
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)![0].replace(/\t/g, "    ").length;
    const item = line.match(LIST_ITEM)?.[1]?.trim();
    if (!item) {
      if (!open.length || indent <= open.at(-1)!.indent) close(indent, true);
      continue;
    }
    close(indent, false);
    while (open.length && open.at(-1)!.indent >= indent) open.pop();
    if (!blocks.has(indent)) blocks.set(indent, nextBlock++);
    const lead = splitLead(item);
    const entry: ListItem = {
      name: lead ? nameFrom(lead.raw) : null,
      rest: lead ? lead.rest : item,
      hasLead: lead !== null,
      bold: lead?.bold ?? false,
      line: item,
      indent,
      block: blocks.get(indent)!,
      children: [],
    };
    open.at(-1)?.children.push(entry);
    open.push(entry);
    items.push(entry);
  }
  return items;
}

/** What may follow a brand that an item leads into: “Solana: Phantom is the usual choice”, “Backpack or Solflare”. */
const AFTER_PICK = /^(?:\*\*|__|\])*(?:$|[.,;:()/!?–—]|\s+(?:or|and|is|are|plus|with|for|if|as|via|paired|works|fits|suits|—|–)(?=\s|$)|\s*\(|\s*$)/i;

function leadsWithBrand(item: ListItem, brandKeys: string[]): boolean {
  const rest = item.rest.replace(/^(?:\*\*|__|\[)+/, "");
  const text = rest.toLowerCase();
  const own = item.name?.toLowerCase();
  return brandKeys.some((key) => key !== own && text.startsWith(key) && AFTER_PICK.test(rest.slice(key.length)));
}

const startsWithWords = (name: string, prefix: string) => name.toLowerCase().startsWith(`${prefix.toLowerCase()} `);

/**
 * Leads that are labels, not brands. In a list where items lead into a pick (“**Mostly Solana:** Phantom”),
 * every lead is a situation. A bare heading over nested brands (“**Solana**” over “**Phantom** – …”) is a group,
 * unless the brands under it are its own product lines.
 */
function labelItems(items: ListItem[], brandKeys: string[]): Set<ListItem> {
  const picks = new Map<number, number>();
  for (const item of items) {
    if (item.hasLead && leadsWithBrand(item, brandKeys)) picks.set(item.block, (picks.get(item.block) ?? 0) + 1);
  }
  const isBrand = (name: string | null) => name !== null && brandKeys.includes(name.toLowerCase());
  const labels = new Set<ListItem>();
  for (const item of items) {
    if (!item.name) continue;
    if ((picks.get(item.block) ?? 0) >= 2) labels.add(item);
    else if (!item.rest.replace(/[\s:*_]+/g, "")) {
      const nested = item.children.filter((child) => child.bold && isBrand(child.name));
      if (nested.length && !nested.some((child) => startsWithWords(child.name!, item.name!))) labels.add(item);
    }
  }
  return labels;
}

interface Found {
  /** Spellings seen, with the number of answers each first appeared in. */
  names: Map<string, number>;
  answers: Set<number>;
  firstSeen: number;
  context: string;
}

const displayName = (names: Map<string, number>) => [...names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
const MAX_CONTEXT = 200;

function collect(answers: ListItem[][], keysOf: (name: string) => string[], knownKeys: Set<string>, labels: (items: ListItem[]) => Set<ListItem>) {
  const found = new Map<string, Found>();
  let order = 0;
  for (const [index, items] of answers.entries()) {
    const skip = labels(items);
    for (const item of items) {
      if (!item.name || skip.has(item)) continue;
      const keys = keysOf(item.name);
      if (keys.some((key) => knownKeys.has(key))) continue;
      const entry = keys.map((key) => found.get(key)).find(Boolean) ?? { names: new Map(), answers: new Set(), firstSeen: order++, context: item.line.slice(0, MAX_CONTEXT) };
      for (const key of keys) found.set(key, entry);
      if (entry.answers.has(index)) continue;
      entry.answers.add(index);
      entry.names.set(item.name, (entry.names.get(item.name) ?? 0) + 1);
    }
  }
  return [...new Set(found.values())];
}

/**
 * Product lines count as their brand: “Ledger Nano X” and “Ledger Flex” as Ledger when Ledger is found too,
 * and “MetaMask Flask” as MetaMask, which is already tracked.
 */
function foldProductLines(entries: Found[], knownNames: string[]): Found[] {
  const kept: Found[] = [];
  for (const entry of [...entries].sort((a, b) => displayName(a.names).length - displayName(b.names).length)) {
    const name = displayName(entry.names);
    if (knownNames.some((known) => startsWithWords(name, known))) continue;
    const brand = kept.find((other) => startsWithWords(name, displayName(other.names)));
    if (!brand) {
      kept.push(entry);
      continue;
    }
    for (const answer of entry.answers) brand.answers.add(answer);
    brand.firstSeen = Math.min(brand.firstSeen, entry.firstSeen);
  }
  return kept;
}

/** Finds likely brands from list items in answers, excluding brands already tracked. */
export function discoverCandidates(texts: string[], known: string[], options: DiscoverOptions = {}): DiscoveredBrand[] {
  const minAnswers = options.minAnswers ?? 2;
  const keysOf = (name: string) => brandAliases(name, options.category).map((n) => n.toLowerCase());
  const knownKeys = new Set(known.flatMap(keysOf));
  const answers = texts.map(listItems);
  const prose = texts.map((text) => text.replace(LINKS, " "));
  const recurring = (entries: Found[]) =>
    entries.filter((entry) => entry.answers.size >= minAnswers && !isEverydayWord(displayName(entry.names), entry.answers.size, prose));

  const brandKeys = [
    ...new Set([...knownKeys, ...recurring(collect(answers, keysOf, knownKeys, () => new Set())).flatMap((entry) => [...entry.names.keys()].flatMap(keysOf))]),
  ].sort((a, b) => b.length - a.length);
  const found = foldProductLines(
    collect(answers, keysOf, knownKeys, (items) => labelItems(items, brandKeys)),
    (options.tracked ?? known).map((name) => name.trim()).filter(Boolean),
  );
  return recurring(found)
    .sort((a, b) => b.answers.size - a.answers.size || a.firstSeen - b.firstSeen)
    .map((entry) => ({ name: displayName(entry.names), answers: entry.answers.size, context: entry.context }));
}

export function discoverBrands(texts: string[], known: string[], options: DiscoverOptions = {}): string[] {
  return discoverCandidates(texts, known, options).map((brand) => brand.name);
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
