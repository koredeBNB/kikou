import type { ProviderStatus } from "@/lib/providers/config";
import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

export interface RunError {
  model: ModelId;
  questionId: string;
  message: string;
}

export interface StoredRun {
  id: string;
  createdAt: string;
  brief: Brief;
  questions: Question[];
  models: ProviderStatus[];
  answers: ModelAnswer[];
  errors: RunError[];
  elapsedMs: number;
}

export const INDEX_KEY = "meadowlark:runs";
export const runKey = (id: string) => `meadowlark:run:${id}`;
const MAX_RUNS = 12;

export function saveRun(run: StoredRun): void {
  try {
    localStorage.setItem(runKey(run.id), JSON.stringify(run));
    const index = listRuns().filter((r) => r.id !== run.id);
    index.unshift({ id: run.id, product: run.brief.product, createdAt: run.createdAt });
    for (const stale of index.splice(MAX_RUNS)) localStorage.removeItem(runKey(stale.id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage can be full or disabled (private mode); the in-memory run still works.
  }
}

export function loadRun(id: string): StoredRun | null {
  try {
    const raw = localStorage.getItem(runKey(id));
    return raw ? (JSON.parse(raw) as StoredRun) : null;
  } catch {
    return null;
  }
}

export function listRuns(): { id: string; product: string; createdAt: string }[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function newRunId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
