import { callStructuredModel, type IntakeModelSetting, type StructuredSpec } from "@/lib/intake/model";
import type { Env } from "@/lib/providers/config";
import { buildQuestionPrompt, QUESTIONS_JSON_SCHEMA, readQuestionList, type QuestionWriter } from "@/lib/sov/generate";

export const QUESTIONS_TIMEOUT_MS = 40_000;

const SPEC: StructuredSpec = { name: "buyer_questions", schema: QUESTIONS_JSON_SCHEMA, maxTokens: 2000, temperature: 0.8 };

/** `SOV_QUESTIONS_TIMEOUT_MS` overrides how long one writer call may take. */
export function questionsTimeout(env: Env): number {
  const ms = Number(env.SOV_QUESTIONS_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : QUESTIONS_TIMEOUT_MS;
}

export function modelQuestionWriter(
  setting: IntakeModelSetting,
  { fetchImpl, timeoutMs = QUESTIONS_TIMEOUT_MS, signal }: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): QuestionWriter {
  return async (request) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const raw = await callStructuredModel(setting, buildQuestionPrompt(request), SPEC, {
      fetchImpl,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return readQuestionList(raw);
  };
}
