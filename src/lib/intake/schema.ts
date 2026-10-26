import { INTAKE_FIELDS, type IntakeIntent, type IntakeNext, type IntakeTurn, type IntakeValues } from "@/lib/intake/types";
import { siteDomain } from "@/lib/sov/citations";
import { looksLikeName, readAudience, readCategory } from "@/lib/sov/intake";

const INTENTS: IntakeIntent[] = ["answer", "skip", "unclear"];
const NEXT: IntakeNext[] = [...INTAKE_FIELDS, "review"];
const MAX_MESSAGE = 400;
const MAX_VALUE = 120;
const MAX_COMPETITORS = 8;

const nullable = (type: "string" | "array") => ({ type: [type, "null"] });

/** Strict JSON Schema for the intake model's structured output. */
export const INTAKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "values", "asks", "message"],
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
      },
    },
    asks: { type: "string", enum: NEXT },
    message: { type: "string" },
  },
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function decode(raw: unknown): unknown {
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
const tidy = (value: string) => value.replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "").trim().slice(0, MAX_VALUE);

/** Brand names and domains must come from the reply itself, so the model can't invent them. */
function inReply(value: string, reply: string): boolean {
  const needle = squash(value);
  return needle.length > 0 && ` ${squash(reply)} `.includes(` ${needle} `);
}

function cleanMessage(value: string): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_MESSAGE) return undefined;
  if (/https?:|www\.|[<>`]|\]\(/i.test(text)) return undefined;
  return text;
}

function cleanValues(values: Json, reply: string): IntakeValues | null {
  const out: IntakeValues = {};
  for (const key of ["product", "category", "audience", "website"] as const) {
    const value = values[key];
    if (value !== undefined && value !== null && typeof value !== "string") return null;
  }
  const rawCompetitors = values.competitors;
  if (rawCompetitors !== undefined && rawCompetitors !== null) {
    if (!Array.isArray(rawCompetitors) || rawCompetitors.some((c) => typeof c !== "string")) return null;
  }

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
  return out;
}

/**
 * Validates the model's structured output and cleans its values with the same rules as the
 * parser. Returns null when the output is unusable, so the caller can fall back to the rules.
 */
export function parseIntakeTurn(raw: unknown, reply: string): IntakeTurn | null {
  const data = decode(raw);
  if (!isObject(data)) return null;
  const { intent, values, asks, message } = data;
  if (!INTENTS.includes(intent as IntakeIntent)) return null;
  if (!NEXT.includes(asks as IntakeNext)) return null;
  if (typeof message !== "string") return null;
  if (values !== undefined && !isObject(values)) return null;

  const cleaned = cleanValues(values ?? {}, reply);
  if (!cleaned) return null;
  if (intent === "answer" && Object.keys(cleaned).length === 0) return null;

  const turn: IntakeTurn = { intent: intent as IntakeIntent, values: cleaned, asks: asks as IntakeNext };
  const text = cleanMessage(message);
  if (text) turn.message = text;
  return turn;
}
