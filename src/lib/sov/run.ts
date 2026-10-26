import { resolveProviders, type Env, type LiveSetting, type ProviderSetting } from "@/lib/providers/config";
import { ANSWER_TIMEOUT_MS, askLive, ProviderError, type LiveResult } from "@/lib/providers/live";
import { answerCost, searches } from "@/lib/sov/estimate";
import { mockAnswer } from "@/lib/sov/mock";
import type { TaskResult } from "@/lib/store/types";
import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

export interface AnswerOptions {
  brief: Brief;
  env: Env;
  /** False switches web search off for this check. */
  webSearch?: boolean;
  fetchImpl?: typeof fetch;
  /** Waits out mock latency and retry backoff, so tests can skip both. */
  delay?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** How long one attempt may take. */
  timeoutMs?: number;
  /** Epoch ms the answer must be in by. Attempts are cut short to fit, and retries stop when time runs out. */
  deadline?: number;
  now?: () => number;
}

/** Retries for rate limits and server errors; a timeout is retried once. */
export const MAX_RETRIES = 3;
const BACKOFF_MS = 2000;
const MAX_WAIT_MS = 30_000;
/** A retry needs at least this long left before the deadline to be worth starting. */
export const MIN_ATTEMPT_MS = 8000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function forCheck(setting: ProviderSetting, webSearch: boolean): ProviderSetting {
  return setting.live && !webSearch ? { ...setting, webSearch: false } : setting;
}

/** How long to wait before retry number `attempt`, or null when the failure isn't worth retrying. */
export function retryWait(error: unknown, attempt: number): number | null {
  if (!(error instanceof ProviderError)) return null;
  if (error.timedOut) return attempt <= 1 ? 0 : null;
  const status = error.status ?? 0;
  if (attempt > MAX_RETRIES || !(status === 429 || status >= 500)) return null;
  return Math.min(error.retryAfterMs ?? BACKOFF_MS * 2 ** (attempt - 1), MAX_WAIT_MS);
}

async function askWithRetries(model: ModelId, setting: LiveSetting, question: Question, options: AnswerOptions): Promise<LiveResult> {
  const { fetchImpl = fetch, delay = sleep, signal, deadline, now = Date.now } = options;
  const limit = options.timeoutMs ?? ANSWER_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    const left = deadline === undefined ? Infinity : deadline - now();
    try {
      return await askLive(model, question.text, setting, fetchImpl, signal, { timeoutMs: Math.max(1, Math.min(limit, left)) });
    } catch (error) {
      const wait = signal?.aborted ? null : retryWait(error, attempt);
      if (wait === null) throw error;
      if (deadline !== undefined && deadline - now() - wait < MIN_ATTEMPT_MS) throw error;
      if (wait > 0) await delay(wait);
      if (signal?.aborted) throw error;
    }
  }
}

/** One assistant's answer to one question, with retries, and what it cost. Failures come back as error results. */
export async function answerTask(model: ModelId, question: Question, options: AnswerOptions): Promise<{ result: TaskResult; costUsd: number }> {
  const { brief, env, delay = sleep, now = Date.now } = options;
  const setting = forCheck(resolveProviders(env)[model], options.webSearch !== false);
  const began = now();
  try {
    let answer: ModelAnswer;
    if (setting.live) {
      const result = await askWithRetries(model, setting, question, options);
      answer = { questionId: question.id, model, text: result.text, citations: result.citations, source: "live", latencyMs: now() - began };
      if (result.costUsd !== undefined) answer.costUsd = result.costUsd;
    } else {
      answer = mockAnswer(brief, question, model);
      await delay(answer.latencyMs);
    }
    return { result: { type: "answer", answer }, costUsd: answerCost(answer, setting.live && searches(model, setting.webSearch, true)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { result: { type: "error", model, questionId: question.id, message }, costUsd: 0 };
  }
}
