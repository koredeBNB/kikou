import { listJoin } from "@/lib/format";
import { ownDomains } from "@/lib/sov/citations";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import type { Brief, Question, QuestionIntent } from "@/lib/sov/types";

export const MAX_QUESTIONS = 100;
/** Most questions one writer call is asked for, so each reply stays short and quick. */
export const BATCH_SIZE = 25;
const MAX_ASK = 34;
const MIN_LENGTH = 12;
const MAX_LENGTH = 200;
const NEAR_DUPLICATE = 0.8;
/** Questions that name a rival also lift that rival's mentions, so only a few may. */
const COMPETITOR_SHARE = 0.25;

export interface QuestionSlot {
  topic?: string;
  count: number;
}

export function questionSlots(count: number, topics: string[] = []): QuestionSlot[] {
  if (topics.length === 0) return [{ count }];
  const base = Math.floor(count / topics.length);
  const extra = count % topics.length;
  return topics.map((topic, i) => ({ topic, count: base + (i < extra ? 1 : 0) })).filter((slot) => slot.count > 0);
}

const INTENT_RULES: [Exclude<QuestionIntent, "custom" | "use-case">, RegExp][] = [
  ["alternatives", /\b(?:alternatives?|instead of|similar to|competitors? (?:to|of))\b/i],
  ["comparison", /\b(?:vs\.?|versus|compared?|compares|comparing|comparison|better than|which is better|difference between|between \S+(?: \S+)? (?:and|or))(?=\W|$)/i],
  ["switching", /\b(?:switch\w*|migrat\w*|mov(?:e|ing) (?:away )?from|leav(?:e|ing)|replac(?:e|ing)|outgr\w*)\b/i],
  ["budget", /\b(?:cheap\w*|affordable|budget|free|low[- ]cost|inexpensive|pric(?:e|es|ed|ing)|fees?|costs?|value for money)\b/i],
  ["beginner", /\b(?:beginners?|newbies?|novices?|first[- ]time\w*|new to|just start\w*|getting started|easiest|simplest)\b/i],
  ["top-list", /\b(?:top(?: \d+)?|most (?:popular|recommended|trusted|used)|popular|leading|rank\w*|list of)\b/i],
  ["best-for", /\bbest\b/i],
  ["features", /\b(?:features?|integrat\w*|security|secure|support\w*|reliab\w*|safe\w*|privacy|ease of use)\b/i],
];

export function classifyIntent(text: string): Exclude<QuestionIntent, "custom"> {
  return INTENT_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "use-case";
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a name as a whole word, also when its words are squashed or hyphenated ("TrustWallet", "trust-wallet"). */
function namePattern(name: string): RegExp | null {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean).map(escape);
  if (words.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s\\-_.]*")}(?![\\p{L}\\p{N}])`, "iu");
}

function productPatterns(brief: Brief): RegExp[] {
  const names = [brief.product];
  for (const domain of ownDomains(brief)) {
    names.push(domain);
    const stem = domain.split(".")[0];
    if (stem.length >= 3) names.push(stem);
  }
  return names.map(namePattern).filter((p): p is RegExp => p !== null);
}

const STOP_WORDS = new Set(
  "a an the and or of for to in on at by with from about is are be was do does did can could should would will i im i'm me my we our you your it its it's that this these those which what whats s who how where when there their them they most best any some get one".split(
    " ",
  ),
);

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function tokens(text: string): Set<string> {
  const words = normalize(text)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
  return new Set(words);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

const LEAD = /^(?:(?:\d{1,3}[.):]|[-*•–—]|q\d{1,3}[.):])\s*)+/i;
const QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

const REQUEST = /^(recommend|compare|list|suggest|name|rank|tell|give|show|help|find|pick|point)\b/i;
const ASKS = /\b(which|what|who|whom|whose|how|where|why|when|should|is|are|can|could|do|does|would|will)\b/i;

/** Requests like “Compare the fees of…” end with a full stop; everything else is a question. */
function tidy(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim().replace(LEAD, "").trim().replace(QUOTES, "").trim();
  text = text.replace(/[.!?;:,\s]+$/, "");
  if (!text) return "";
  const request = REQUEST.test(text) && !ASKS.test(text.replace(REQUEST, ""));
  text += request ? "." : "?";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface CleanOptions {
  brief: Brief;
  /** Questions already in the plan; anything too close to one of these is dropped. */
  existing?: string[];
  limit?: number;
  maxNamingCompetitors?: number;
}

/** Turns a writer's raw list into usable questions: tidy, unbranded, distinct, and not too rival-heavy. */
export function cleanGeneratedQuestions(raw: unknown[], { brief, existing = [], limit = Infinity, maxNamingCompetitors = Infinity }: CleanOptions): string[] {
  const banned = productPatterns(brief);
  const rivals = brief.competitors.map(namePattern).filter((p): p is RegExp => p !== null);
  const seenText = new Set(existing.map(normalize));
  const seenTokens = existing.map(tokens);
  const kept: string[] = [];
  let naming = 0;

  for (const item of raw) {
    if (kept.length >= limit) break;
    if (typeof item !== "string") continue;
    const text = tidy(item);
    if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) continue;
    if (banned.some((pattern) => pattern.test(text))) continue;
    const key = normalize(text);
    if (seenText.has(key)) continue;
    const words = tokens(text);
    if (seenTokens.some((other) => similarity(words, other) >= NEAR_DUPLICATE)) continue;
    const namesRival = rivals.some((pattern) => pattern.test(text));
    if (namesRival && naming >= maxNamingCompetitors) continue;
    if (namesRival) naming++;
    seenText.add(key);
    seenTokens.push(words);
    kept.push(text);
  }
  return kept;
}

/** Reads `{questions: [...]}`, a bare list, or either as a JSON string. */
export function readQuestionList(raw: unknown): unknown[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  const questions = (value as { questions?: unknown } | null)?.questions;
  return Array.isArray(questions) ? questions : [];
}

export interface TemplateOptions {
  topic?: string;
  year?: number;
}

/** Fallback questions for when no writer model is available or it comes back short. */
export function templateQuestions(brief: Brief, { topic, year = new Date().getFullYear() }: TemplateOptions = {}): string[] {
  const { category, audience, competitors } = brief;
  const forAudience = audience ? ` for ${audience}` : "";
  const rivals = competitors.slice(0, 3);

  if (topic) {
    return [
      `What's the best ${category} for ${topic}?`,
      `Which ${category} is strongest on ${topic}?`,
      `Which ${category} do people recommend for ${topic} in ${year}?`,
      `What should I look for in a ${category} when ${topic} matters most?`,
      `Which ${category} is easiest for a beginner who cares about ${topic}?`,
      `What's the most affordable ${category} that's still good at ${topic}?`,
      `Which ${category} handles ${topic} better than the rest?`,
      `Are there ${category} options that specialise in ${topic}?`,
      `How do the popular ${category} options compare on ${topic}?`,
      `Which ${category} has the most reliable ${topic} features?`,
      ...(audience ? [`What's the best ${category} for ${topic}${forAudience}?`] : []),
      ...rivals.map((rival) => `Is there a better ${category} than ${rival} for ${topic}?`),
    ];
  }

  return [
    `Which ${category} is easiest for beginners to get started with?`,
    `What's a good first ${category} for someone just starting out?`,
    `How do the most popular ${category} options compare?`,
    `Which ${category} has the best reviews right now?`,
    `What ${category} do experts recommend in ${year}?`,
    `Which ${category} offers the best value for money?`,
    `Is there a free ${category} that's actually good?`,
    `Which ${category} is the most reliable?`,
    `Which ${category} is the safest choice?`,
    `Which ${category} has the best customer support?`,
    `Which ${category} works best on a phone?`,
    `What ${category} would you recommend to a friend?`,
    `What should I look for when choosing a ${category}?`,
    `Which ${category} is best for everyday use?`,
    `Which ${category} do power users prefer?`,
    `Which ${category} is the most trusted?`,
    `Which ${category} has the fewest complaints from users?`,
    `What's the simplest ${category} with no learning curve?`,
    `Which ${category} has the lowest fees?`,
    `Which ${category} has improved the most over the last year?`,
    `Which ${category} has the best privacy protections?`,
    `What ${category} is worth paying for?`,
    `Which ${category} is the fastest to set up?`,
    `Which ${category} has the cleanest, easiest interface?`,
    ...(audience
      ? [
          `What ${category} do most ${audience} use?`,
          `Which ${category} suits ${audience} on a tight budget?`,
          `What's the most beginner-friendly ${category}${forAudience}?`,
        ]
      : []),
    ...rivals.flatMap((rival) => [`Is ${rival} still the best ${category}, or is there something better?`, `How does ${rival} compare with other ${category} options?`]),
    ...(rivals.length >= 2 ? [`${rivals[0]} or ${rivals[1]}: which ${category} is better?`] : []),
  ];
}

export interface GenerationRequest {
  category: string;
  audience: string;
  competitors: string[];
  /** Never to be mentioned. */
  product: string;
  website?: string;
  otherSites?: string[];
  topic?: string;
  angle: string;
  count: number;
  avoid: string[];
  year?: number;
}

/** Returns the writer's raw output: `{questions}`, a list, or JSON text of either. */
export type QuestionWriter = (request: GenerationRequest) => Promise<unknown>;

export const QUESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: { questions: { type: "array", items: { type: "string" } } },
} as const;

const MIX = "a balanced mix of “best X for Y”, alternatives, comparisons, beginner questions, budget and pricing, specific use cases, and features";
const ANGLES = [
  "“best X for Y” questions and specific use cases",
  "alternatives, side-by-side comparisons and switching from another option",
  "beginners, budget, pricing and value for money",
  "features, reliability, trust, safety and support",
];
const TOP_UP_ANGLE = "angles and situations the list to avoid doesn't cover yet";

export function buildQuestionPrompt(request: GenerationRequest): { system: string; user: string } {
  const { category, audience, competitors, product, topic, angle, count, year } = request;
  const domains = ownDomains(request);
  const subject = `${category}${audience ? ` for ${audience}` : ""}`;
  const brands = competitors.length
    ? `- Only name brands from this list, and in at most a quarter of the questions: ${competitors.join(", ")}.`
    : "- Don't name any brands.";
  const system = [
    "You write the questions real buyers type into AI assistants such as ChatGPT, Claude, Gemini and Perplexity while researching what to choose.",
    `Write exactly ${count} different questions about choosing a ${subject}${topic ? `, every one of them about ${topic}` : ""}.`,
    "Rules:",
    `- Never mention “${product}”${domains.length ? ` or ${listJoin(domains, "or")}` : ""}, and don't hint at it. The questions must be unbranded so every recommendation is unprompted.`,
    brands,
    "- Every question should lead the assistant to name specific products: which one to pick, recommendations, alternatives or comparisons. No general how-to or explainer questions.",
    "- Each question stands alone in plain, everyday English, 6 to 25 words, and ends with a question mark.",
    ...(year ? [`- It's ${year}, but rarely mention a year, and never an earlier one.`] : []),
    "- Vary the wording, the situation and the person asking. No two questions may ask the same thing, and none may repeat one from \"avoid\".",
    `- Focus on ${angle}.`,
    'Return JSON: {"questions": ["...", "..."]}.',
  ].join("\n");
  const user = JSON.stringify({ category, audience: audience || null, topic: topic ?? null, count, avoid: request.avoid });
  return { system, user };
}

const askFor = (size: number) => Math.min(size + Math.max(3, Math.ceil(size * 0.3)), MAX_ASK);

function batchSizes(total: number): number[] {
  const batches = Math.ceil(total / BATCH_SIZE);
  const base = Math.floor(total / batches);
  const extra = total % batches;
  return Array.from({ length: batches }, (_, i) => base + (i < extra ? 1 : 0));
}

function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}

interface FillResult {
  texts: string[];
  fromModel: number;
  fromTemplates: number;
}

async function fill(
  brief: Brief,
  { needed, topic, existing, write, year }: { needed: number; topic?: string; existing: string[]; write?: QuestionWriter; year: number },
): Promise<FillResult> {
  const kept: string[] = [];
  let naming = 0;
  const cap = Math.max(1, Math.ceil(needed * COMPETITOR_SHARE));
  const rivals = brief.competitors.map(namePattern).filter((p): p is RegExp => p !== null);
  const take = (raw: unknown[]) => {
    const texts = cleanGeneratedQuestions(raw, {
      brief,
      existing: [...existing, ...kept],
      limit: needed - kept.length,
      maxNamingCompetitors: cap - naming,
    });
    for (const text of texts) if (rivals.some((pattern) => pattern.test(text))) naming++;
    kept.push(...texts);
    return texts.length;
  };
  const base = {
    category: brief.category,
    audience: brief.audience,
    competitors: brief.competitors,
    product: brief.product,
    website: brief.website,
    otherSites: brief.otherSites,
    topic,
    year,
  };

  let fromModel = 0;
  if (write) {
    const sizes = batchSizes(needed);
    const replies = await Promise.all(
      sizes.map((size, i) =>
        write({ ...base, angle: sizes.length === 1 ? MIX : ANGLES[i % ANGLES.length], count: askFor(size), avoid: existing.slice(0, 40) })
          .then(readQuestionList)
          .catch(() => [] as unknown[]),
      ),
    );
    fromModel += take(interleave(replies));
    const missing = needed - kept.length;
    if (fromModel > 0 && missing > 0) {
      const again = await write({ ...base, angle: TOP_UP_ANGLE, count: askFor(missing), avoid: [...existing, ...kept].slice(-80) })
        .then(readQuestionList)
        .catch(() => [] as unknown[]);
      fromModel += take(again);
    }
  }
  const fromTemplates = kept.length < needed ? take(templateQuestions(brief, { topic, year })) : 0;
  return { texts: kept, fromModel, fromTemplates };
}

export type PlanSource = "built-in" | "ai" | "templates" | "mixed";

export interface QuestionPlan {
  questions: Question[];
  source: PlanSource;
  /** How many were asked for; `questions` can be shorter when not enough distinct ones could be written. */
  requested: number;
}

export interface PlanOptions {
  write?: QuestionWriter;
  year?: number;
}

function sourceOf(results: FillResult[]): PlanSource {
  const model = results.reduce((sum, r) => sum + r.fromModel, 0);
  const templates = results.reduce((sum, r) => sum + r.fromTemplates, 0);
  if (model === 0) return "templates";
  return templates === 0 ? "ai" : "mixed";
}

/**
 * Plans `count` unbranded questions. A broad check starts from the built-in set and tops it up;
 * with topics, every question is written for its topic and the count is split evenly between them.
 */
export async function planQuestions(input: Brief, count: number, { write, year = new Date().getFullYear() }: PlanOptions = {}): Promise<QuestionPlan> {
  const brief = normalizeBrief(input);
  const requested = Math.min(Math.max(Math.round(count) || 1, 1), MAX_QUESTIONS);
  const number = (items: Omit<Question, "id">[]): Question[] => items.map((item, i) => ({ ...item, id: `q${i + 1}` }));
  const topics = brief.topics ?? [];

  if (topics.length === 0) {
    const builtIns = generateQuestions(brief, { year });
    if (requested <= builtIns.length) return { questions: builtIns.slice(0, requested), source: "built-in", requested };
    const extra = await fill(brief, { needed: requested - builtIns.length, existing: builtIns.map((q) => q.text), write, year });
    const generated = extra.texts.map((text) => ({ text, intent: classifyIntent(text) }));
    return { questions: number([...builtIns, ...generated]), source: sourceOf([extra]), requested };
  }

  const slots = questionSlots(requested, topics);
  const results = await Promise.all(slots.map((slot) => fill(brief, { needed: slot.count, topic: slot.topic, existing: [], write, year })));
  const seen = new Set<string>();
  const items: Omit<Question, "id">[] = [];
  results.forEach((result, i) => {
    for (const text of result.texts) {
      const key = normalize(text);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ text, intent: classifyIntent(text), topic: slots[i].topic });
    }
  });
  return { questions: number(items), source: sourceOf(results), requested };
}
