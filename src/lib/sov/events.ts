import type { ProviderStatus } from "@/lib/providers/config";
import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

export type RunEvent =
  | {
      type: "start";
      brief: Brief;
      questions: Question[];
      models: ProviderStatus[];
      total: number;
    }
  | { type: "answer"; answer: ModelAnswer }
  | { type: "error"; model: ModelId; questionId: string; message: string }
  | { type: "done"; elapsedMs: number; costUsd: number }
  | { type: "ping" };

export interface CheckRequest {
  brief: Brief;
  questions: Question[];
  models?: ModelId[];
  /** Off skips web search for this check (Perplexity always searches). Defaults to the server setting. */
  webSearch?: boolean;
}
