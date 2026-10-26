import type { ProviderStatus } from "@/lib/providers/config";
import type { AnswerSource, ModelId } from "@/lib/sov/types";

export interface AnswerRate {
  costUsd: number;
  /** Average time one answer takes. */
  seconds: number;
}

export type RateTable = Record<ModelId, { search: AnswerRate; plain: AnswerRate }>;

/**
 * Average cost and latency per answer, measured on live OpenRouter checks with the default models.
 * Perplexity always searches, so both of its rates are the same.
 */
export const ANSWER_RATES: RateTable = {
  chatgpt: { search: { costUsd: 0.022, seconds: 13.5 }, plain: { costUsd: 0.0003, seconds: 7 } },
  claude: { search: { costUsd: 0.012, seconds: 7.5 }, plain: { costUsd: 0.0005, seconds: 5 } },
  gemini: { search: { costUsd: 0.05, seconds: 6 }, plain: { costUsd: 0.0014, seconds: 4.5 } },
  perplexity: { search: { costUsd: 0.006, seconds: 8 }, plain: { costUsd: 0.006, seconds: 8 } },
};

/** Answers each assistant works on at once during a check. */
export const PER_MODEL_CONCURRENCY = 5;

export interface EstimateModel {
  id: ModelId;
  live: boolean;
  /** Whether the server has web search on for this assistant. */
  webSearch: boolean;
}

export interface EstimateInput {
  questions: number;
  models: EstimateModel[];
  /** The check's web search switch. It can only turn search off; Perplexity searches regardless. */
  webSearch: boolean;
}

export interface Estimate {
  answers: number;
  costUsd: number;
  seconds: number;
  perModel: { model: ModelId; costUsd: number; seconds: number }[];
}

const DEMO_SECONDS = 1.8;

export const searches = (model: ModelId, serverSearch: boolean, checkSearch: boolean) =>
  model === "perplexity" || (serverSearch && checkSearch);

function rateFor(model: EstimateModel, webSearch: boolean, rates: RateTable): AnswerRate {
  if (!model.live) return { costUsd: 0, seconds: DEMO_SECONDS };
  return searches(model.id, model.webSearch, webSearch) ? rates[model.id].search : rates[model.id].plain;
}

export function estimateCheck(input: EstimateInput, rates: RateTable = ANSWER_RATES): Estimate {
  const questions = Math.max(0, Math.floor(input.questions));
  const rounds = Math.ceil(questions / PER_MODEL_CONCURRENCY);
  const perModel = input.models.map((model) => {
    const rate = rateFor(model, input.webSearch, rates);
    return { model: model.id, costUsd: questions * rate.costUsd, seconds: rounds * rate.seconds };
  });
  return {
    answers: questions * input.models.length,
    costUsd: perModel.reduce((sum, m) => sum + m.costUsd, 0),
    seconds: Math.max(0, ...perModel.map((m) => m.seconds)),
    perModel,
  };
}

/** The estimate for a plan, from the server's description of each assistant. Unknown ones count as demo. */
export function estimateFor(
  { questions, models, providers, webSearch }: { questions: number; models: ModelId[]; providers: ProviderStatus[]; webSearch: boolean },
  rates: RateTable = ANSWER_RATES,
): Estimate {
  const described = new Map(providers.map((p) => [p.id, p]));
  return estimateCheck(
    {
      questions,
      models: models.map((id) => {
        const status = described.get(id);
        return { id, live: status?.source === "live", webSearch: status?.webSearch ?? false };
      }),
      webSearch,
    },
    rates,
  );
}

/** Whether the check's web search switch would change anything for these assistants. */
export function canSwitchSearch(models: ModelId[], providers: ProviderStatus[]): boolean {
  return providers.some((p) => models.includes(p.id) && p.id !== "perplexity" && p.source === "live" && p.webSearch);
}

/** What one answer cost: the provider's own figure when it reports one, otherwise the assistant's average. */
export function answerCost(
  answer: { model: ModelId; source: AnswerSource; costUsd?: number },
  searched: boolean,
  rates: RateTable = ANSWER_RATES,
): number {
  if (answer.source === "mock") return 0;
  if (typeof answer.costUsd === "number") return answer.costUsd;
  return (searched || answer.model === "perplexity" ? rates[answer.model].search : rates[answer.model].plain).costUsd;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatUsd = (value: number) => USD.format(Math.max(0, value));

export function formatDuration(seconds: number): string {
  if (seconds < 45) return "under a minute";
  if (seconds < 90) return "roughly a minute";
  return `roughly ${Math.round(seconds / 60)} minutes`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Pip's line before a check: "100 questions to 4 AIs is 400 answers. That's about $11.50 and roughly 12 minutes. Go ahead?" */
export function estimateLine({
  questions,
  assistants,
  estimate,
  ask = true,
}: {
  questions: number;
  assistants: number;
  estimate: Estimate;
  ask?: boolean;
}): string {
  const sizing = `${plural(questions, "question")} to ${assistants} AI${assistants === 1 ? "" : "s"} is ${plural(estimate.answers, "answer")}.`;
  const time = formatDuration(estimate.seconds);
  const question = ask ? " Go ahead?" : "";
  if (estimate.costUsd === 0) return `${sizing} They're demo answers, so it's free and takes ${time}.${question}`;
  const cost = estimate.costUsd < 0.01 ? "less than a cent" : `about ${formatUsd(estimate.costUsd)}`;
  return `${sizing} That's ${cost} and ${time}.${question}`;
}

/** The plan card's summary: "400 answers · about $9.05 · roughly 5 minutes". */
export function estimateSummary(estimate: Estimate): string {
  const cost = estimate.costUsd === 0 ? "free (demo)" : estimate.costUsd < 0.01 ? "under a cent" : `about ${formatUsd(estimate.costUsd)}`;
  return `${plural(estimate.answers, "answer")} · ${cost} · ${formatDuration(estimate.seconds)}`;
}
