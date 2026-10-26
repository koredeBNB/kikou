import type { ProviderStatus } from "@/lib/providers/config";
import type { TaskResult } from "@/lib/store/types";
import type { Brief, ModelId, Question } from "@/lib/sov/types";

/** One line of a batch response: an answer, a failed answer, or a keep-alive ping. */
export type BatchEvent = TaskResult | { type: "ping" };

export interface CheckRequest {
  brief: Brief;
  questions: Question[];
  models?: ModelId[];
  /** Off skips web search for this check (Perplexity always searches). Defaults to the server setting. */
  webSearch?: boolean;
}

/** `POST /api/check` starts a check and returns this; the browser then asks for the answers in batches. */
export interface CheckStarted {
  runId: string;
  models: ProviderStatus[];
  total: number;
}

export interface TaskRef {
  model: ModelId;
  questionId: string;
}

/** `POST /api/check/[id]/finish` releases the check's budget hold and returns what it cost. */
export interface CheckFinished {
  costUsd: number;
}

/** Most answers one batch request may ask for. */
export const MAX_BATCH = 5;
