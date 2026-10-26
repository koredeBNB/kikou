import type { CheckRequest } from "@/lib/sov/events";
import { MODEL_IDS, type ModelId, type QuestionIntent } from "@/lib/sov/types";

const INTENTS: QuestionIntent[] = ["best-for", "top-list", "alternatives", "budget", "switching", "features", "custom"];
const MAX_QUESTIONS = 10;
const MAX_TEXT = 300;

const str = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export type ValidationResult = { ok: true; value: Required<CheckRequest> } | { ok: false; error: string };

export function validateCheckRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a JSON body." };
  const body = input as Record<string, unknown>;
  const brief = (body.brief ?? {}) as Record<string, unknown>;

  const product = str(brief.product);
  const category = str(brief.category);
  if (!product) return { ok: false, error: "Tell me the product name." };
  if (!category) return { ok: false, error: "Tell me the product category." };

  const competitors = Array.isArray(brief.competitors)
    ? brief.competitors.map((c) => str(c)).filter(Boolean).slice(0, 8)
    : [];

  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
  const questions = rawQuestions
    .map((q, i) => {
      const item = (q ?? {}) as Record<string, unknown>;
      const intent = INTENTS.includes(item.intent as QuestionIntent) ? (item.intent as QuestionIntent) : "custom";
      return { id: str(item.id, 20) || `q${i + 1}`, text: str(item.text, MAX_TEXT), intent };
    })
    .filter((q) => q.text);
  if (questions.length === 0) return { ok: false, error: "Add at least one question." };
  if (questions.length > MAX_QUESTIONS) return { ok: false, error: `Up to ${MAX_QUESTIONS} questions per check.` };

  const requested = Array.isArray(body.models) ? body.models : MODEL_IDS;
  const models = MODEL_IDS.filter((m) => requested.includes(m)) as ModelId[];
  if (models.length === 0) return { ok: false, error: "Pick at least one model." };

  return {
    ok: true,
    value: {
      brief: {
        product,
        category,
        audience: str(brief.audience),
        competitors,
        website: str(brief.website) || undefined,
      },
      questions,
      models,
      webSearch: body.webSearch !== false,
    },
  };
}
