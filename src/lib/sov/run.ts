import { providerStatus, resolveProviders, type Env, type LiveSetting, type ProviderSetting } from "@/lib/providers/config";
import { askLive, ProviderError, type LiveResult } from "@/lib/providers/live";
import { answerCost, PER_MODEL_CONCURRENCY, searches } from "@/lib/sov/estimate";
import type { RunEvent } from "@/lib/sov/events";
import { mockAnswer } from "@/lib/sov/mock";
import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

export interface RunOptions {
  brief: Brief;
  questions: Question[];
  models: ModelId[];
  env: Env;
  /** False switches web search off for this check. */
  webSearch?: boolean;
  fetchImpl?: typeof fetch;
  /** Waits out mock latency and retry backoff, so tests can skip both. */
  delay?: (ms: number) => Promise<void>;
  /** Requests in flight at once for each assistant. */
  concurrency?: number;
  signal?: AbortSignal;
  /** Running total of what the check has cost, readable even when it stops early. */
  meter?: CostMeter;
  /** How long one answer may take. */
  timeoutMs?: number;
  /** Emits a ping this often while the check runs, so proxies don't close a quiet stream. */
  heartbeatMs?: number;
}

export interface CostMeter {
  costUsd: number;
}

/** Retries for rate limits and server errors; a timeout is retried once. */
export const MAX_RETRIES = 3;
const BACKOFF_MS = 2000;
const MAX_WAIT_MS = 30_000;

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

export async function runCheck(options: RunOptions, emit: (event: RunEvent) => void): Promise<void> {
  const { brief, questions, models, env, fetchImpl = fetch, delay = sleep, signal, timeoutMs } = options;
  const webSearch = options.webSearch !== false;
  const providers = resolveProviders(env);
  const started = Date.now();
  const status = providerStatus(env).filter((p) => models.includes(p.id));
  const meter = options.meter ?? { costUsd: 0 };

  emit({ type: "start", brief, questions, models: status, total: questions.length * models.length });
  const heartbeat = options.heartbeatMs ? setInterval(() => !signal?.aborted && emit({ type: "ping" }), options.heartbeatMs) : undefined;

  const ask = async (model: ModelId, setting: LiveSetting, question: Question): Promise<LiveResult> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await askLive(model, question.text, setting, fetchImpl, signal, { timeoutMs });
      } catch (error) {
        const wait = signal?.aborted ? null : retryWait(error, attempt);
        if (wait === null) throw error;
        if (wait > 0) await delay(wait);
        if (signal?.aborted) throw error;
      }
    }
  };

  const answerOne = async (model: ModelId, question: Question) => {
    const setting = forCheck(providers[model], webSearch);
    const began = Date.now();
    try {
      let answer: ModelAnswer;
      if (setting.live) {
        const result = await ask(model, setting, question);
        answer = { questionId: question.id, model, text: result.text, citations: result.citations, source: "live", latencyMs: Date.now() - began };
        if (result.costUsd !== undefined) answer.costUsd = result.costUsd;
      } else {
        answer = mockAnswer(brief, question, model);
        await delay(answer.latencyMs);
      }
      meter.costUsd += answerCost(answer, setting.live && searches(model, setting.webSearch, true));
      if (!signal?.aborted) emit({ type: "answer", answer });
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown error";
      emit({ type: "error", model, questionId: question.id, message });
    }
  };

  // Each assistant gets its own small pool, so one slow or rate-limited assistant doesn't hold up the others.
  const perModel = Math.max(1, options.concurrency ?? PER_MODEL_CONCURRENCY);
  const pools = models.map((model) => {
    let next = 0;
    const worker = async () => {
      while (next < questions.length && !signal?.aborted) await answerOne(model, questions[next++]);
    };
    return Array.from({ length: Math.min(perModel, questions.length) }, worker);
  });

  try {
    await Promise.all(pools.flat());
  } finally {
    clearInterval(heartbeat);
  }
  if (!signal?.aborted) emit({ type: "done", elapsedMs: Date.now() - started, costUsd: meter.costUsd });
}
