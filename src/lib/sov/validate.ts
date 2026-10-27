import { otherSitesOf } from "@/lib/sov/citations";
import type { CheckRequest } from "@/lib/sov/events";
import { MAX_QUESTIONS } from "@/lib/sov/generate";
import { MAX_TOPICS } from "@/lib/sov/intake";
import { MODEL_IDS, type Brief, type ModelId, type Question, type QuestionIntent } from "@/lib/sov/types";

const INTENTS: QuestionIntent[] = [
  "best-for",
  "top-list",
  "alternatives",
  "budget",
  "switching",
  "features",
  "comparison",
  "beginner",
  "use-case",
  "custom",
];
const MAX_TEXT = 300;
const MAX_TOPIC = 40;

const str = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function readTopics(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const raw of value) {
    const topic = str(raw, MAX_TOPIC);
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    topics.push(topic);
    if (topics.length === MAX_TOPICS) break;
  }
  return topics.length ? topics : undefined;
}

function readBrief(input: unknown): { ok: true; value: Brief } | { ok: false; error: string } {
  const brief = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const product = str(brief.product);
  const category = str(brief.category);
  if (!product) return { ok: false, error: "Tell me the product name." };
  if (!category) return { ok: false, error: "Tell me the product category." };
  const competitors = Array.isArray(brief.competitors) ? brief.competitors.map((c) => str(c)).filter(Boolean).slice(0, 8) : [];
  const value: Brief = { product, category, audience: str(brief.audience), competitors, website: str(brief.website) || undefined };
  const otherSites = otherSitesOf(value.website, brief.otherSites);
  if (otherSites.length) value.otherSites = otherSites;
  const topics = readTopics(brief.topics);
  if (topics) value.topics = topics;
  return { ok: true, value };
}

/** Well-formed questions only, each with a unique id since answers are matched back by id. */
export function readQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const questions: Question[] = [];
  input.forEach((raw, i) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const text = str(item.text, MAX_TEXT);
    if (!text) return;
    let id = str(item.id, 20) || `q${i + 1}`;
    if (ids.has(id)) id = `x${i + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    const intent = INTENTS.includes(item.intent as QuestionIntent) ? (item.intent as QuestionIntent) : "custom";
    const question: Question = { id, text, intent };
    const topic = str(item.topic, MAX_TOPIC);
    if (topic) question.topic = topic;
    questions.push(question);
  });
  return questions;
}

export type ValidationResult = { ok: true; value: Required<CheckRequest> } | { ok: false; error: string };

export function validateCheckRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a JSON body." };
  const body = input as Record<string, unknown>;
  const brief = readBrief(body.brief);
  if (!brief.ok) return brief;

  const questions = readQuestions(body.questions);
  if (questions.length === 0) return { ok: false, error: "Add at least one question." };
  if (questions.length > MAX_QUESTIONS) return { ok: false, error: `Up to ${MAX_QUESTIONS} questions per check.` };

  const requested = Array.isArray(body.models) ? body.models : MODEL_IDS;
  const models = MODEL_IDS.filter((m) => requested.includes(m)) as ModelId[];
  if (models.length === 0) return { ok: false, error: "Pick at least one model." };

  return { ok: true, value: { brief: brief.value, questions, models, webSearch: body.webSearch !== false } };
}

export function validateQuestionRequest(input: unknown): { ok: true; value: { brief: Brief; count: number } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a JSON body." };
  const body = input as Record<string, unknown>;
  const brief = readBrief(body.brief);
  if (!brief.ok) return brief;
  const count = body.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_QUESTIONS) {
    return { ok: false, error: `Ask for between 1 and ${MAX_QUESTIONS} questions.` };
  }
  return { ok: true, value: { brief: brief.value, count } };
}
