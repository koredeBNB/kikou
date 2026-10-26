import { siteDomain } from "@/lib/sov/citations";
import type { Brief } from "@/lib/sov/types";

export type IntroFields = Partial<Pick<Brief, "product" | "category" | "audience" | "website">>;

/** "skip": the user declined or wants Pip to work it out. "unclear": an answer Pip couldn't use. */
export type Reply<T> = { kind: "ok"; value: T } | { kind: "skip" } | { kind: "unclear" };

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z]{2,}(?:\.[a-z]{2,})?\/?$/i;
const DOMAIN_IN_TEXT = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/i;
const SEPARATOR = /^(.+?)(?:\s*,\s*|\s+[-–—]\s+|\s+is\s+|\s*:\s*)(.+)$/i;

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function clean(value: string): string {
  return value.trim().replace(/[.!?]+$/, "").trim();
}

const words = (value: string) => value.split(/\s+/).filter(Boolean);

function stripLeads(value: string, lead: RegExp): string {
  let text = value.trim();
  for (let next = text.replace(lead, "").trim(); next !== text; next = text.replace(lead, "").trim()) text = next;
  return text;
}

/** Reads "Acme, a CRM for small agencies" style intros into brief fields. */
export function parseIntro(input: string): IntroFields {
  const text = clean(input);
  if (!text) return {};

  const domain = text.match(DOMAIN);
  if (domain) {
    return { product: titleCase(domain[1]), website: text.replace(/^https?:\/\//i, "").replace(/\/$/, "") };
  }

  const split = text.match(SEPARATOR);
  if (!split) return { product: text };

  const product = clean(split[1]);
  const rest = clean(split[2]).replace(/^(?:a|an|the)\s+/i, "");
  const forIndex = rest.search(/\s+for\s+/i);
  if (forIndex === -1) return { product, category: rest };

  const category = clean(rest.slice(0, forIndex));
  const audience = clean(rest.slice(forIndex).replace(/^\s+for\s+/i, ""));
  return { product, category, ...(audience ? { audience } : {}) };
}

const FILLERS =
  /\b(?:really|honestly|just|um+|uh+|hmm+|well|actually|basically|literally|tbh|lol|haha|sorry|please|pls|i guess|i think|probably|maybe|for now|at the moment|right now|to be honest)\b/g;

const WHOLE_NON_ANSWERS = new Set([
  "skip", "pass", "none", "nothing", "no", "nope", "nah", "na", "n/a", "tbd", "tba", "unknown", "idk", "idc", "dunno",
  "unsure", "no idea", "no clue", "anyone", "anybody", "everyone", "everybody", "all", "any", "whatever", "no one",
  "nobody", "not really", "not yet", "none yet", "nothing yet", "no competitors", "no competition", "no rivals",
  "no website", "no site", "no domain", "no url", "not applicable", "later", "next", "coming soon",
]);

const NON_ANSWER_PATTERNS = [
  /\bidk\b|\bdunno\b|\bunsure\b|\bno\s+(?:idea|clue)\b/,
  /(?:^|\b(?:i'?m|i am|we'?re|we are|honestly|um|uh|hmm|tbh)\s+)not\s+(?:\w+\s+)?(?:sure|certain)\b/,
  /(?:^|\b(?:i|we|honestly|um|uh)\s+)(?:don'?t|do\s+not|dont)\s+(?:really\s+)?know\b/,
  /(?:^|\b(?:i|we)\s+)can'?t\s+think\b/,
  /(?:^|\b(?:you|can you|could you|please|just|pls|so)\s+)find\b/,
  /\byou\s+(?:tell|decide|pick|choose|figure)\b|\bup\s+to\s+you\b|\byour\s+call\b|\bsurprise\s+me\b/,
  /^(?:we\s+|i\s+)?(?:don'?t|do\s+not|dont|doesn'?t|haven'?t)\s+(?:have|got)\b/,
  /^not\s+yet\b/,
];

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'/?\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True for replies that decline, express uncertainty, or ask Pip to work it out. */
export function isNonAnswer(input: string): boolean {
  const text = normalise(input);
  if (!text.replace(/\?/g, "").trim()) return true;
  const core = text.replace(/\?/g, " ").replace(FILLERS, " ").replace(/\s+/g, " ").trim();
  if (!core || WHOLE_NON_ANSWERS.has(core)) return true;
  return NON_ANSWER_PATTERNS.some((pattern) => pattern.test(text));
}

const SENTENCE_WORDS = new Set([
  "i", "i'm", "im", "i'd", "i've", "me", "my", "mine", "you", "your", "you're", "we", "we're", "our", "us", "they",
  "they're", "them", "their", "he", "she", "it", "it's", "its", "is", "are", "am", "was", "were", "be", "been", "do",
  "does", "did", "don't", "dont", "doesn't", "didn't", "can", "can't", "cant", "could", "would", "should", "will",
  "won't", "have", "has", "had", "not", "maybe", "probably", "think", "know", "sure", "guess", "find", "tell", "look",
  "search", "please", "just", "any", "some", "idea", "within", "answer", "answers", "results", "there", "here", "what",
  "which", "who", "why", "how", "if", "so", "but", "because", "about", "really", "also", "else", "other", "others",
  "competitor", "competitors", "rival", "rivals", "rest", "usually", "lose", "ones", "those", "these", "that", "this",
  "to", "of", "in", "from", "with", "than", "then", "when", "like", "want", "see",
]);

/** A short name, not a sentence. Title-cased names may contain common words ("You Need A Budget"). */
export function looksLikeName(value: string): boolean {
  const parts = words(value);
  if (parts.length === 0 || parts.length > 4 || value.length > 40 || !/[\p{L}\p{N}]/u.test(value)) return false;
  if (isNonAnswer(value)) return false;
  const chatty = parts.some((w) => SENTENCE_WORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
  return !chatty || parts.every((w) => /^[\p{Lu}\p{N}]/u.test(w));
}

const COMPETITOR_LEAD = new RegExp(
  `^(?:${[
    "(?:i|we)\\s+(?:think|guess|reckon|believe|would\\s+say|'d\\s+say)",
    "i'?d\\s+say",
    "(?:i|we)\\s+(?:mostly\\s+|mainly\\s+|usually\\s+)?(?:compete|competing)\\s+(?:with|against)",
    "(?:we'?re|we\\s+are)\\s+up\\s+against",
    "(?:our|my|the)\\s+(?:main\\s+|biggest\\s+|top\\s+)?(?:competitors|rivals|competition)\\s+(?:are|is|include|would\\s+be)",
    "(?:competitors|rivals)(?:\\s+are)?",
    "it'?s|its|they'?re|they\\s+are|that'?s|probably|maybe|mostly|mainly|usually|definitely|honestly|well|um+|uh+",
    "like|e\\.?g\\.?|such\\s+as|vs\\.?|versus",
  ].join("|")})(?:\\s*:\\s*|\\s+|$)`,
  "i",
);

export function readCompetitors(input: string): { kind: "ok"; value: string[]; ignored: string[] } | { kind: "skip" } | { kind: "unclear" } {
  const text = input.trim();
  if (isNonAnswer(text)) return { kind: "skip" };
  const items = stripLeads(text, COMPETITOR_LEAD)
    .split(/\s*(?:,|;|\n|\band\b|\bor\b|&)\s*/i)
    .map((item) => clean(stripLeads(item, COMPETITOR_LEAD)).replace(/\s+(?:etc|and so on)$/i, ""))
    .filter(Boolean);

  const seen = new Set<string>();
  const value: string[] = [];
  const ignored: string[] = [];
  for (const item of items) {
    if (!looksLikeName(item)) {
      ignored.push(item);
      continue;
    }
    if (seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    value.push(item);
  }
  if (value.length) return { kind: "ok", value, ignored };
  return ignored.every(isNonAnswer) ? { kind: "skip" } : { kind: "unclear" };
}

export function parseCompetitors(input: string): string[] {
  const reply = readCompetitors(input);
  return reply.kind === "ok" ? reply.value : [];
}

const GREETING = /^(?:hi+|hello|hey+|hiya|yo|howdy|good\s+(?:morning|afternoon|evening)|test(?:ing)?|start|help)$/;
const PRODUCT_LEAD =
  /^(?:(?:my|our)\s+(?:product|app|company|tool|brand|startup|business|service|platform|site)(?:'s|\s+is)?(?:\s+(?:called|named))?|(?:it'?s|it\s+is|we'?re|we\s+are|this\s+is)\s+(?:called|named)|it'?s|we'?re|this\s+is|called|named)\s+/i;

export function readProduct(input: string): Reply<IntroFields> {
  const text = input.trim();
  if (isNonAnswer(text) || GREETING.test(normalise(text))) return { kind: "skip" };
  const fields = parseIntro(stripLeads(text, PRODUCT_LEAD));
  if (!fields.product || !looksLikeName(fields.product)) return { kind: "unclear" };
  const value: IntroFields = { product: fields.product };
  const category = fields.category ? readCategory(fields.category) : null;
  if (category?.kind === "ok") value.category = category.value.category;
  const audience = fields.audience ? readAudience(fields.audience) : null;
  if (audience?.kind === "ok") value.audience = audience.value;
  if (fields.website) value.website = fields.website;
  return { kind: "ok", value };
}

const CATEGORY_LEAD =
  /^(?:it'?s|it\s+is|its|we'?re|we\s+are|this\s+is|they'?re|(?:we|i)\s+(?:make|build|sell|offer|run|have)|a\s+kind\s+of|kind\s+of|sort\s+of|basically|a|an|the)\s+/i;
const CATEGORY_BLOCKLIST = new Set([
  "i", "me", "my", "we", "our", "us", "you", "your", "it", "they", "them", "their", "he", "she", "is", "are", "was",
  "helps", "lets", "allows", "makes", "does", "do", "can", "will", "want",
]);

export function readCategory(input: string): Reply<{ category: string; audience?: string }> {
  const text = input.trim();
  if (isNonAnswer(text)) return { kind: "skip" };
  const [rawCategory, ...rest] = stripLeads(clean(text), CATEGORY_LEAD).split(/\s+for\s+/i);
  const category = clean(rawCategory);
  const parts = words(category);
  if (!category || parts.length > 6 || category.length > 60 || parts.some((w) => CATEGORY_BLOCKLIST.has(w.toLowerCase()))) {
    return { kind: "unclear" };
  }
  const audience = rest.length ? readAudience(rest.join(" for ")) : null;
  return { kind: "ok", value: audience?.kind === "ok" ? { category, audience: audience.value } : { category } };
}

const AUDIENCE_LEAD =
  /^(?:it'?s|it\s+is|this\s+is|mostly|mainly|probably|basically|primarily|usually|(?:our\s+)?(?:customers|users|buyers)\s+are|we\s+(?:sell\s+to|serve|target)|aimed\s+at|(?:built|made|designed)\s+for|for|the)\s+/i;

export function readAudience(input: string): Reply<string> {
  const text = input.trim();
  if (isNonAnswer(text)) return { kind: "skip" };
  const audience = clean(stripLeads(clean(text), AUDIENCE_LEAD));
  if (!audience || words(audience).length > 12) return { kind: "unclear" };
  return { kind: "ok", value: audience };
}

const WEBSITE_SKIP = [/\b(?:coming\s+soon|under\s+construction|not\s+live|not\s+launched|launching\s+soon|in\s+progress)\b/, /^(?:no|none|not)\b.*\b(?:site|website|domain|url|page)\b/];

export function readWebsite(input: string): Reply<string> {
  const text = input.trim();
  const token = text.match(DOMAIN_IN_TEXT)?.[0];
  const domain = token ? siteDomain(token) : null;
  if (domain) return { kind: "ok", value: domain };
  if (isNonAnswer(text) || WEBSITE_SKIP.some((pattern) => pattern.test(normalise(text)))) return { kind: "skip" };
  return { kind: "unclear" };
}

const START =
  /^(?:let'?s\s+(?:go|start|do\s+(?:it|this))|go(?:\s+ahead)?|start(?:\s+(?:it|now|the\s+check))?|run(?:\s+(?:it|the\s+check))?|yes|yep|yeah|yup|sure|ok(?:ay)?|looks?\s+good|sounds?\s+good|perfect|great|ready|do\s+it|ask(?:\s+them)?|that'?s\s+(?:all|it|everything)|all\s+good|good\s+to\s+go)$/;

/** A reply on the question plan: start the check, or add the user's own buyer question. */
export function readPlanReply(input: string): { kind: "start" } | Reply<string> {
  const text = input.trim();
  if (START.test(normalise(text).replace(/\?/g, "").trim())) return { kind: "start" };
  if (isNonAnswer(text)) return { kind: "skip" };
  if (words(text).length < 3) return { kind: "unclear" };
  return { kind: "ok", value: /[?.!]$/.test(text) ? text : `${text}?` };
}
