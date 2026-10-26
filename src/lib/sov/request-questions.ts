import { planQuestions, type PlanSource, type QuestionPlan } from "@/lib/sov/generate";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import type { Brief } from "@/lib/sov/types";
import { readQuestions } from "@/lib/sov/validate";

/** Longer than a few slow writer calls back to back; after this the plan is made from templates instead. */
export const QUESTIONS_CLIENT_TIMEOUT_MS = 90_000;
const SOURCES: PlanSource[] = ["built-in", "ai", "templates", "mixed"];

/** Asks the server to write the question plan, falling back to a local template plan so review always opens. */
export async function requestQuestions(
  brief: Brief,
  count: number,
  { fetchImpl = fetch, timeoutMs = QUESTIONS_CLIENT_TIMEOUT_MS, year }: { fetchImpl?: typeof fetch; timeoutMs?: number; year?: number } = {},
): Promise<QuestionPlan> {
  const normalized = normalizeBrief(brief);
  const local = () => planQuestions(normalized, count, { year });
  if (!normalized.topics?.length && count <= generateQuestions(normalized).length) return local();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: normalized, count }),
      signal: abort.signal,
    });
    if (!response.ok) return local();
    const data = (await response.json()) as { questions?: unknown; source?: unknown };
    const questions = readQuestions(data.questions);
    if (questions.length === 0) return local();
    const source = SOURCES.includes(data.source as PlanSource) ? (data.source as PlanSource) : "mixed";
    return { questions, source, requested: count };
  } catch {
    return local();
  } finally {
    clearTimeout(timer);
  }
}
