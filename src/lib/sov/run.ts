import { providerStatus, resolveProviders, type Env, type ProviderSetting } from "@/lib/providers/config";
import { askLive } from "@/lib/providers/live";
import { answerCost, searches } from "@/lib/sov/estimate";
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
  /** Mock answers wait out their simulated latency so the stream feels like real models. */
  delay?: (ms: number) => Promise<void>;
  concurrency?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function forCheck(setting: ProviderSetting, webSearch: boolean): ProviderSetting {
  return setting.live && !webSearch ? { ...setting, webSearch: false } : setting;
}

export async function runCheck(options: RunOptions, emit: (event: RunEvent) => void): Promise<void> {
  const { brief, questions, models, env, fetchImpl = fetch, delay = sleep, signal } = options;
  const webSearch = options.webSearch !== false;
  const providers = resolveProviders(env);
  const started = Date.now();
  const status = providerStatus(env).filter((p) => models.includes(p.id));
  const tasks = questions.flatMap((question) => models.map((model) => ({ question, model })));
  let costUsd = 0;

  emit({ type: "start", brief, questions, models: status, total: tasks.length });

  let next = 0;
  const worker = async () => {
    while (next < tasks.length && !signal?.aborted) {
      const { question, model } = tasks[next++];
      const setting = forCheck(providers[model], webSearch);
      const began = Date.now();
      try {
        let answer: ModelAnswer;
        if (setting.live) {
          const result = await askLive(model, question.text, setting, fetchImpl, signal);
          answer = {
            questionId: question.id,
            model,
            text: result.text,
            citations: result.citations,
            source: "live",
            latencyMs: Date.now() - began,
          };
          if (result.costUsd !== undefined) answer.costUsd = result.costUsd;
        } else {
          answer = mockAnswer(brief, question, model);
          await delay(answer.latencyMs);
        }
        costUsd += answerCost(answer, setting.live && searches(model, setting.webSearch, true));
        if (!signal?.aborted) emit({ type: "answer", answer });
      } catch (error) {
        if (signal?.aborted) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        emit({ type: "error", model, questionId: question.id, message });
      }
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, tasks.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (!signal?.aborted) emit({ type: "done", elapsedMs: Date.now() - started, costUsd });
}
