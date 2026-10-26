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

// The keys predate the rename to Kioku; changing them would orphan every saved report.
export const INDEX_KEY = "meadowlark:runs";
export const runKey = (id: string) => `meadowlark:run:${id}`;
const MAX_RUNS = 12;

/** Runs that didn't fit in storage, so their report still opens in this tab. */
const unsaved = new Map<string, StoredRun>();

/**
 * Saves a run, removing the oldest reports when storage is full. Returns false when it can't be
 * saved at all (too big, or storage disabled); the reports it removed are then put back.
 */
export function saveRun(run: StoredRun): boolean {
  unsaved.delete(run.id);
  const removed: [string, string][] = [];
  try {
    const payload = JSON.stringify(run);
    const others = listRuns().filter((r) => r.id !== run.id);
    const remove = (id: string) => {
      const key = runKey(id);
      const value = localStorage.getItem(key);
      if (value !== null) removed.push([key, value]);
      localStorage.removeItem(key);
    };
    for (const stale of others.splice(MAX_RUNS - 1)) remove(stale.id);
    for (;;) {
      try {
        localStorage.setItem(runKey(run.id), payload);
        localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: run.id, product: run.brief.product, createdAt: run.createdAt }, ...others]));
        return true;
      } catch {
        localStorage.removeItem(runKey(run.id));
        const oldest = others.pop();
        if (!oldest) break;
        remove(oldest.id);
      }
    }
    for (const [key, value] of removed.reverse()) localStorage.setItem(key, value);
  } catch {
    // Storage is disabled (private mode) or the restore failed; the in-memory copy below still works.
  }
  unsaved.clear();
  unsaved.set(run.id, run);
  return false;
}

export const unsavedRun = (id: string): StoredRun | null => unsaved.get(id) ?? null;

export function loadRun(id: string): StoredRun | null {
  const pending = unsaved.get(id);
  if (pending) return pending;
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
