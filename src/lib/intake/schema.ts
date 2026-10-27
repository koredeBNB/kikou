import {
  INTAKE_FIELDS,
  OPTIONAL_FIELDS,
  type IntakeField,
  type IntakeIntent,
  type IntakeNext,
  type IntakeTurn,
  type IntakeValues,
  type OptionalField,
} from "@/lib/intake/types";
import { siteDomain } from "@/lib/sov/citations";
import { looksLikeName, MAX_QUESTION_COUNT, MAX_TOPICS, readAudience, readCategory, readCount } from "@/lib/sov/intake";

const INTENTS: IntakeIntent[] = ["answer", "skip", "unclear"];
const NEXT: IntakeNext[] = [...INTAKE_FIELDS, "review"];
const MAX_MESSAGE = 400;
const MAX_VALUE = 120;
const MAX_COMPETITORS = 8;
const MAX_TOPIC = 40;

const nullable = (type: "string" | "array" | "integer") => ({ type: [type, "null"] });

/** Strict JSON Schema for the intake model's structured output. */
export const INTAKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "values", "skips", "asks", "message"],
  properties: {
    intent: { type: "string", enum: INTENTS },
    values: {
      type: "object",
      additionalProperties: false,
      required: [...INTAKE_FIELDS],
      properties: {
        product: nullable("string"),
        category: nullable("string"),
        audience: nullable("string"),
        competitors: { ...nullable("array"), items: { type: "string" } },
        website: nullable("string"),
        topics: { ...nullable("array"), items: { type: "string" } },
        count: nullable("integer"),
      },
    },
    skips: { type: "array", items: { type: "string", enum: OPTIONAL_FIELDS } },
    asks: { type: "string", enum: NEXT },
    message: { type: "string" },
  },
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export function decode(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const tidy = (value: string) => value.replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "").trim().slice(0, MAX_VALUE);

/** Brand names and domains must come from the reply itself, so the model can't invent them. */
export function inReply(value: string, reply: string): boolean {
  const needle = squash(value);
  return needle.length > 0 && ` ${squash(reply)} `.includes(` ${needle} `);
}

/** A decline only counts when the reply talks about that field, so the model can't skip steps on its own. */
const MENTIONS: Record<OptionalField, RegExp> = {
  audience: /\b(?:audience|everyone|anyone|customers?|users?|buyers?)\b/i,
  competitors: /\b(?:competitors?|competition|rivals?|alternatives?)\b/i,
  website: /\b(?:web\s*site|site|domain|url)\b/i,
  topics: /\b(?:topics?|focus|areas?|angles?|broad|general)\b/i,
  count: /\b(?:questions?|how\s+many|count|number)\b/i,
};

function cleanSkips(skips: unknown[], values: IntakeValues, reply: string): OptionalField[] {
  return OPTIONAL_FIELDS.filter((field) => skips.includes(field) && values[field] === undefined && MENTIONS[field].test(reply));
}

export function cleanMessage(value: string): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_MESSAGE) return undefined;
  if (/https?:|www\.|[<>`]|\]\(/i.test(text)) return undefined;
  return text;
}

const isStringList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

function cleanValues(values: Json, reply: string, field?: IntakeField): { values: IntakeValues; capped: boolean } | null {
  const out: IntakeValues = {};
  for (const key of ["product", "category", "audience", "website"] as const) {
    const value = values[key];
    if (value !== undefined && value !== null && typeof value !== "string") return null;
  }
  const rawCompetitors = values.competitors;
  for (const key of ["competitors", "topics"] as const) {
    const value = values[key];
    if (value !== undefined && value !== null && !isStringList(value)) return null;
  }
  const rawCount = values.count;
  if (rawCount !== undefined && rawCount !== null && !Number.isInteger(rawCount)) return null;

  const product = typeof values.product === "string" ? tidy(values.product) : "";
  if (product && looksLikeName(product) && inReply(product, reply)) out.product = product;

  if (typeof values.category === "string") {
    const category = readCategory(tidy(values.category));
    if (category.kind === "ok") out.category = category.value.category;
  }
  if (typeof values.audience === "string") {
    const audience = readAudience(tidy(values.audience));
    if (audience.kind === "ok") out.audience = audience.value;
  }

  if (Array.isArray(rawCompetitors)) {
    const seen = new Set(out.product ? [out.product.toLowerCase()] : []);
    const competitors: string[] = [];
    for (const raw of rawCompetitors as string[]) {
      const name = tidy(raw);
      if (!name || seen.has(name.toLowerCase()) || !looksLikeName(name) || !inReply(name, reply)) continue;
      seen.add(name.toLowerCase());
      competitors.push(name);
      if (competitors.length === MAX_COMPETITORS) break;
    }
    if (competitors.length) out.competitors = competitors;
  }

  if (typeof values.website === "string") {
    const domain = siteDomain(values.website.trim());
    if (domain && inReply(domain, reply)) out.website = domain;
  }

  if (Array.isArray(values.topics)) {
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const raw of values.topics as string[]) {
      const topic = tidy(raw).slice(0, MAX_TOPIC).trim();
      if (!topic || seen.has(topic.toLowerCase()) || topic.split(" ").length > 5 || !inReply(topic, reply)) continue;
      seen.add(topic.toLowerCase());
      topics.push(topic);
      if (topics.length === MAX_TOPICS) break;
    }
    if (topics.length) out.topics = topics;
  }

  // A count needs a number in the reply, and the reply must be about how many questions to ask.
  let capped = false;
  if (typeof rawCount === "number" && rawCount >= 1 && readCount(reply).kind === "ok" && (field === "count" || /\bquestions?\b/i.test(reply))) {
    out.count = Math.min(rawCount, MAX_QUESTION_COUNT);
    capped = rawCount > MAX_QUESTION_COUNT;
  }
  return { values: out, capped };
}

/**
 * Validates the model's structured output and cleans its values with the same rules as the
 * parser. Returns null when the output is unusable, so the caller can fall back to the rules.
 */
export function parseIntakeTurn(raw: unknown, reply: string, field?: IntakeField): IntakeTurn | null {
  const data = decode(raw);
  if (!isObject(data)) return null;
  const { intent, values, skips, asks, message } = data;
  if (!INTENTS.includes(intent as IntakeIntent)) return null;
  if (!NEXT.includes(asks as IntakeNext)) return null;
  if (typeof message !== "string") return null;
  if (values !== undefined && !isObject(values)) return null;
  if (skips !== undefined && skips !== null && !Array.isArray(skips)) return null;

  const cleaned = cleanValues(values ?? {}, reply, field);
  if (!cleaned) return null;
  if (intent === "answer" && Object.keys(cleaned.values).length === 0) return null;

  const turn: IntakeTurn = { intent: intent as IntakeIntent, values: cleaned.values, asks: asks as IntakeNext };
  if (cleaned.capped) turn.capped = true;
  const declined = cleanSkips(Array.isArray(skips) ? skips : [], cleaned.values, reply);
  if (declined.length) turn.skips = declined;
  const text = cleanMessage(message);
  if (text) turn.message = text;
  return turn;
}
