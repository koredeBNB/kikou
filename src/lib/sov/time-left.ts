import type { ModelId } from "@/lib/sov/types";

/** Answers an assistant must have in before its pace is worth extrapolating. */
const MIN_ANSWERS = 3;

export interface TimeLeftInput {
  elapsedMs: number;
  models: ModelId[];
  /** Questions per assistant. */
  questions: number;
  answers: { model: ModelId; latencyMs: number }[];
  errors: { model: ModelId }[];
}

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Each assistant works through its own queue, so the check ends when the slowest one does.
 * Each pace comes from that assistant's answers so far, and never drops below one of its typical answers.
 */
export function secondsLeft({ elapsedMs, models, questions, answers, errors }: TimeLeftInput): number | null {
  let slowest = 0;
  for (const model of models) {
    const latencies = answers.filter((a) => a.model === model).map((a) => a.latencyMs);
    const done = latencies.length + errors.filter((e) => e.model === model).length;
    if (done >= questions) continue;
    if (done < MIN_ANSWERS) return null;
    const paced = (elapsedMs / done) * (questions - done);
    slowest = Math.max(slowest, paced, median(latencies));
  }
  return slowest > 0 ? slowest / 1000 : null;
}

export function timeLeft(input: TimeLeftInput): string | null {
  const seconds = secondsLeft(input);
  if (seconds === null) return null;
  if (seconds < 45) return "almost done";
  if (seconds < 90) return "about a minute left";
  return `about ${Math.round(seconds / 60)} minutes left`;
}
