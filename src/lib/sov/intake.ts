import { cleanSites, coveredBy, siteDomain } from "@/lib/sov/citations";
import type { Brief } from "@/lib/sov/types";

export type IntroFields = Partial<Pick<Brief, "product" | "category" | "audience" | "website">>;

/** "skip": the user declined or wants Pip to work it out. "unclear": an answer Pip couldn't use. */
export type Reply<T> = { kind: "ok"; value: T } | { kind: "skip" } | { kind: "unclear" };

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z]{2,}(?:\.[a-z]{2,})?\/?$/i;
const DOMAINS_IN_TEXT = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;]*)?/gi;
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

const WEBSITE_CLAUSE = new RegExp(
  String.raw`(?:\s*[,;(]\s*|\.\s+|\s+[-–—]\s+|\s+)(?:and\s+)?(?:(?:our|my|the|its)\s+)?(?:(?:web\s*)?site|url|domain|homepage)?(?:'s|\s+is|:)?\s*(?:at\s+|on\s+)?` +
    String.raw`((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s),;]*)?)\s*\)?(?=\s*(?:[,;]|\.?\s*$|\.\s))`,
  "i",
);

/** Splits a website clause ("…, site's fernly.app") out of a longer reply. A leading domain is left alone, as it's usually the name. */
export function takeWebsite(input: string): { text: string; website?: string } {
  const match = WEBSITE_CLAUSE.exec(input);
  const website = match ? siteDomain(match[1]) : null;
  if (!match || !website) return { text: input };
  const text = `${input.slice(0, match.index)}${input.slice(match.index + match[0].length)}`.trim();
  return text ? { text, website } : { text: input };
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

const COMPETITOR_WORD = /\b(?:competitors?|competition|rivals?)\b/i;
const COMPETITOR_CLAUSE = new RegExp(`[^.!;,\\n]*${COMPETITOR_WORD.source}[^.!;,\\n]*`, "gi");

/** "Not sure about competitors", or a decline right after the word: "competitors? not sure". */
function declinesCompetitors(clause: string): boolean {
  if (isNonAnswer(clause)) return true;
  const word = COMPETITOR_WORD.exec(clause);
  const after = word ? clause.slice(word.index + word[0].length).replace(/^[\s?:\-–—]+/, "") : "";
  return after !== "" && isNonAnswer(after);
}

/** Takes a competitor decline ("… Competitors? Honestly not sure") out of a longer reply. */
export function takeCompetitorSkip(input: string): { text: string; skipped: boolean } {
  for (const match of input.matchAll(COMPETITOR_CLAUSE)) {
    if (!declinesCompetitors(match[0])) continue;
    const text = `${input.slice(0, match.index)}${input.slice(match.index + match[0].length)}`
      .replace(/\s*[,;]\s*(?=[,;.!]|$)/g, "")
      .replace(/([.!])\s*[.!]+/g, "$1")
      .trim();
    return { text, skipped: true };
  }
  return { text: input, skipped: false };
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

/** Every domain in the reply, in order, so "fernly.app, and fernly.dev for the docs" gives both. */
export function readWebsites(input: string): Reply<string[]> {
  const text = input.trim();
  const sites = cleanSites([...text.matchAll(DOMAINS_IN_TEXT)].map((match) => match[0]));
  if (sites.length) return { kind: "ok", value: sites };
  if (isNonAnswer(text) || WEBSITE_SKIP.some((pattern) => pattern.test(normalise(text)))) return { kind: "skip" };
  return { kind: "unclear" };
}

const RULED_OUT = /\b(?:not|drop|remove|without|minus|except)\s+(?:the\s+)?$/i;

/** The domains a reply adds and the ones it rules out, as in "also bnb.org" or "drop bnb.org" or "bnb.org, not bnbchain.org". */
export function readSiteChanges(input: string): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const match of input.matchAll(DOMAINS_IN_TEXT)) {
    (RULED_OUT.test(input.slice(0, match.index)) ? remove : add).push(match[0]);
  }
  return { add: cleanSites(add), remove: cleanSites(remove) };
}

export const MAX_QUESTION_COUNT = 100;
export const MAX_TOPICS = 5;
const MAX_TOPIC_CHARS = 40;

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const COUNT_MAX = /\b(?:max(?:imum)?|as many as (?:you can|possible)|the most(?: you can)?|all (?:of them|you can))\b/;
const COUNT_SKIP = /\b(?:you\s+(?:pick|choose|decide)|up\s+to\s+you|your\s+call|default|standard|usual|normal|whatever|recommended)\b/;

function numberWords(text: string): number | null {
  const tokens = text.replace(/-/g, " ").split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (word === "hundred" && (i === 0 || ["a", "one"].includes(tokens[i - 1]))) return 100;
    if (word === "dozen") {
      const before = tokens[i - 1];
      return 12 * (UNITS[before] ?? 1);
    }
    if (TENS[word] !== undefined) {
      const unit = UNITS[tokens[i + 1]];
      return TENS[word] + (unit !== undefined && unit < 10 ? unit : 0);
    }
    if (UNITS[word] !== undefined && tokens[i + 1] !== "dozen" && tokens[i + 1] !== "hundred") return UNITS[word];
  }
  return null;
}

/** How many questions to ask each assistant: "25", "about fifty", "max". Anything over 100 is capped. */
export function readCount(input: string): Reply<{ count: number; capped: boolean }> {
  const text = normalise(input).replace(/\?/g, " ").trim();
  if (COUNT_MAX.test(text)) return { kind: "ok", value: { count: MAX_QUESTION_COUNT, capped: false } };
  const digits = input.replace(/(\d),(\d{3})\b/g, "$1$2").match(/\d+/);
  const count = digits ? Number(digits[0]) : numberWords(text);
  if (count !== null) {
    if (count < 1) return { kind: "unclear" };
    return { kind: "ok", value: { count: Math.min(count, MAX_QUESTION_COUNT), capped: count > MAX_QUESTION_COUNT } };
  }
  if (isNonAnswer(text) || COUNT_SKIP.test(text)) return { kind: "skip" };
  return { kind: "unclear" };
}

const TOPIC_SKIP =
  /^(?:(?:a\s+|keep\s+it\s+|just\s+)?(?:broad|general|wide)(?:\s+(?:check|one|search|overview))?|generally|everything|all of it|all of them|across the board|the whole (?:category|thing)|no(?:\s+(?:particular|specific))?\s+(?:focus|topics?|areas?)|nothing (?:specific|in particular)|none in particular)$/;
const TOPIC_LEAD =
  /^(?:(?:i'?d\s+like\s+(?:you\s+)?to|let'?s|please|can\s+you|could\s+you|maybe|probably|mostly|mainly|primarily|especially|ideally)\s+|(?:focus(?:ing)?\s+(?:on|around)|look\s+at|dig\s+into|cover|within|around|on)\s+|(?:topics?|focus(?:\s+areas?)?)\s*(?::|are|is)?\s+)/i;

function topicList(input: string): { topics: string[]; rejected: number } {
  const items = stripLeads(clean(input), TOPIC_LEAD)
    .split(/\s*(?:,|;|\n|\/|\+|&|\band\b|\bor\b)\s*/i)
    .map((item) => clean(stripLeads(item, TOPIC_LEAD)).replace(/^(?:the|a|an)\s+/i, "").replace(/\s+(?:etc|and so on)$/i, ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const topics: string[] = [];
  let rejected = 0;
  for (const item of items) {
    if (words(item).length > 5 || isNonAnswer(item) || !/\p{L}/u.test(item)) {
      rejected++;
      continue;
    }
    const topic = item.slice(0, MAX_TOPIC_CHARS).trim();
    if (seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    if (topics.length < MAX_TOPICS) topics.push(topic);
  }
  return { topics, rejected };
}

/** Focus areas for the check, as a short list. Skipping means a broad check. */
export function readTopics(input: string): Reply<string[]> {
  const text = input.trim();
  const plain = normalise(text).replace(/\?/g, "").trim();
  if (isNonAnswer(text) || TOPIC_SKIP.test(plain)) return { kind: "skip" };
  const { topics } = topicList(text);
  return topics.length ? { kind: "ok", value: topics } : { kind: "unclear" };
}

const STANDING = String.raw`(?:standing|position(?:ing)?|visibility|presence|reputation|share\s+of\s+voice|ranking|rank|performance)`;
const RESEARCH = new RegExp(
  String.raw`^(?:(?:please|can\s+you|could\s+you|i\s+want\s+to|i'?d\s+like\s+to|help\s+me)\s+)*` +
    String.raw`(?:research|check|analy[sz]e|look\s+(?:at|into)|see|find\s+out|measure|assess|evaluate|audit|track|explore|show\s+me)\s+` +
    String.raw`(?:(?:the|our|my)\s+)?(.+?)(?:'s|’s)\s+${STANDING}\s+(?:within|in|across|for|on|around|among)\s+(.+)$`,
  "i",
);
const HOW_RANKS = /^(?:(?:please|tell\s+me|show\s+me)\s+)?how\s+(?:does|do|is|are)\s+(.+?)\s+(?:rank|stand|do|perform|show\s+up|come\s+up|fare)(?:ing)?\s+(?:within|in|across|for|on|around|among)\s+(.+)$/i;
const FOCUS_CLAUSE =
  /(?:\s*[,;.]\s*|\s+[-–—]\s+|\s+)(?:(?:and|with|but)\s+)?(?:(?:a\s+)?focus(?:ing|ed)?\s+(?:on|around)|(?:(?:my|our|the)\s+)?(?:focus\s+areas?|topics?)\s*(?::|are|=|would\s+be))\s+(.+)$/i;

/** Splits research topics out of a longer reply: "research BNB's standing within trading, RWA, AI" or "…, focusing on A and B". */
export function takeTopics(input: string): { text: string; topics?: string[] } {
  const research = RESEARCH.exec(input.trim()) ?? HOW_RANKS.exec(input.trim());
  if (research) {
    const { topics } = topicList(research[2]);
    const text = clean(research[1]);
    if (topics.length && text) return { text, topics };
  }
  const focus = FOCUS_CLAUSE.exec(input);
  if (focus) {
    const { topics } = topicList(focus[1]);
    const text = input.slice(0, focus.index).replace(/[\s,;.:\-–—]+$/, "").trim();
    if (topics.length && text) return { text, topics };
  }
  return { text: input };
}

const START =
  /^(?:let'?s\s+(?:go|start|do\s+(?:it|this))|go(?:\s+ahead)?|start(?:\s+(?:it|now|the\s+check))?|run(?:\s+(?:it|the\s+check))?|yes|yep|yeah|yup|sure|ok(?:ay)?|looks?\s+good|sounds?\s+good|perfect|great|ready|do\s+it|ask(?:\s+them)?|that'?s\s+(?:all|it|everything)|all\s+good|good\s+to\s+go)$/;

const AGREE_PHRASE = String.raw`(?:yes(?:\s+please)?|yep|yeah|yup|yea|ya|sure|ok(?:ay)?|correct|exactly|right|perfect|great|good|nice|lovely|brilliant|cool|spot\s+on|bang\s+on|nailed\s+it|(?:that'?s|thats|it'?s|its)\s+(?:it|right|correct|perfect|great|fine|the\s+one)|(?:(?:it|that|this|all)\s+)?(?:looks?|sounds?|seems?)\s+(?:right|good|great|perfect|correct|fine)|all\s+(?:good|correct|right)|that\s+one|go\s+(?:ahead|on)|carry\s+on|continue|confirm(?:ed)?|thanks|thank\s+you|cheers|ta)`;
const AGREE = new RegExp(String.raw`^${AGREE_PHRASE}(?:\s+(?:and\s+)?${AGREE_PHRASE})*$`);
const REJECT = /^(?:no|nope|nah|not\s+quite|not\s+really|wrong|incorrect|(?:that'?s|thats|it'?s|its)\s+(?:wrong|not\s+(?:it|right|correct|the\s+one))|not\s+(?:it|right|that\s+one|the\s+one))(?:\s+(?:sorry|thanks))?$/;

const plainReply = (input: string) => normalise(input).replace(/[?/]/g, " ").replace(/\s+/g, " ").trim();

/** A plain yes to the brief Pip drafted: "yes", "looks right", "yep, perfect thanks". */
export function isAgreement(input: string): boolean {
  return AGREE.test(plainReply(input));
}

/** A bare no, with nothing said about what to change. */
export function isRejection(input: string): boolean {
  return REJECT.test(plainReply(input));
}

/** "keep": the current sites are right and complete. "none": there's no site. "set": the sites after the reply. */
export type SitesReply = { kind: "keep" } | { kind: "none" } | { kind: "set"; sites: string[] } | { kind: "unclear" };

const NO_MORE =
  /^(?:(?:yes|yep|yeah|yup|ok(?:ay)?|no|nope|nah)\s+)?(?:that'?s\s+(?:all|it|everything|the\s+lot)|no\s+(?:others?|more)(?:\s+(?:sites?|domains?))?|nothing\s+else|(?:just|only)\s+(?:that|those|that\s+one|the\s+one|one)|thanks|thank\s+you)(?:\s+(?:thanks|thank\s+you|cheers))?$/;
const STARTS_NO = /^(?:no|nope|nah|wrong|actually)\b/;
const ALSO = /\b(?:also|too|as\s+well|plus|another|add)\b/;

/**
 * The rules' reading of a reply about the brand's own sites, for when the model can't help. Domains are
 * added to the current ones unless the reply starts with a no ("no, it's bnb.org"), and ruled-out ones dropped.
 */
export function readSitesReply(reply: string, current: string[]): SitesReply {
  const text = plainReply(reply);
  const { add, remove } = readSiteChanges(reply);
  if (add.length || remove.length) {
    const replace = add.length > 0 && STARTS_NO.test(text) && !ALSO.test(text);
    const kept = replace ? [] : current.filter((site) => !coveredBy(site, remove));
    return { kind: "set", sites: cleanSites([...kept, ...add]) };
  }
  const done = NO_MORE.test(text) || isNonAnswer(reply);
  if (current.length) return done || isAgreement(reply) ? { kind: "keep" } : { kind: "unclear" };
  return done || WEBSITE_SKIP.some((pattern) => pattern.test(normalise(reply))) ? { kind: "none" } : { kind: "unclear" };
}

/** A reply on the question plan: start the check, or add the user's own buyer question. */
export function readPlanReply(input: string): { kind: "start" } | Reply<string> {
  const text = input.trim();
  if (START.test(normalise(text).replace(/\?/g, "").trim())) return { kind: "start" };
  if (isNonAnswer(text)) return { kind: "skip" };
  if (words(text).length < 3) return { kind: "unclear" };
  return { kind: "ok", value: /[?.!]$/.test(text) ? text : `${text}?` };
}
