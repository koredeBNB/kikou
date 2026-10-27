import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

/** What the server keeps about a check while it runs. Answers go to the browser; this only lives for a few hours. */
export interface RunRecord {
  id: string;
  /** UTC day (YYYY-MM-DD) the check started on. */
  day: string;
  createdAt: number;
  brief: Brief;
  questions: Question[];
  models: ModelId[];
  webSearch: boolean;
  /** The estimate held against the daily budget when the check started. */
  estimateUsd: number;
}

export type TaskResult =
  | { type: "answer"; answer: ModelAnswer }
  | { type: "error"; model: ModelId; questionId: string; message: string };

export type ClaimResult = { state: "claimed" } | { state: "done"; result: TaskResult } | { state: "busy" };

export interface Ledger {
  spentUsd: number;
  /** Estimates still held by checks that haven't finished. */
  heldUsd: number;
}

export interface HoldRequest {
  day: string;
  runId: string;
  /** The whole check's estimate. Only the share for answers not yet in is held. */
  estimateUsd: number;
  totalTasks: number;
  /** Null when there's no daily budget. */
  limitUsd: number | null;
  now: number;
}

export interface CompleteRequest {
  runId: string;
  task: string;
  result: TaskResult;
  costUsd: number;
  /** The UTC day the cost is booked to. */
  day: string;
  now: number;
}

/**
 * Run state, the daily spend ledger and rate-limit counters. Every method is atomic, so it holds up with
 * many serverless instances answering parts of the same check at once.
 */
export interface CheckStore {
  /** False for the in-process store, which forgets everything when the server restarts. */
  readonly persistent: boolean;
  saveRun(run: RunRecord): Promise<void>;
  loadRun(id: string): Promise<RunRecord | null>;
  /**
   * Holds a check's estimate against the day's budget, or renews the hold it already has. A new hold is
   * refused when it would take the day past `limitUsd`; the ledger comes back either way.
   */
  hold(request: HoldRequest): Promise<{ ok: boolean } & Ledger>;
  ledger(day: string, now: number): Promise<Ledger>;
  /** Claims one answer for this request, or says it's already answered (with the result) or being answered. */
  claim(runId: string, task: string, now: number): Promise<ClaimResult>;
  /** Saves an answer once, books its cost to the day and draws down the check's hold by the same amount. */
  complete(request: CompleteRequest): Promise<void>;
  /** Drops the check's holds on these days and returns what its answers cost in total. */
  release(runId: string, days: string[]): Promise<{ costUsd: number }>;
  /** Books spending outside a check, such as a web lookup while drafting a brief, to the day. */
  charge(day: string, costUsd: number, now: number): Promise<void>;
  /** Counts one request in a fixed window that starts with the first one. */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetMs: number }>;
}

export const RUN_TTL_SECONDS = 6 * 3600;
export const DAY_TTL_SECONDS = 3 * 86_400;
/** A hold lapses this long after the check last asked for answers, so an abandoned check frees its budget. */
export const HOLD_LEASE_MS = 10 * 60_000;
/** Longer than a batch request may run, so a claim left by a crashed request expires and can be retried. */
export const CLAIM_MS = 130_000;

export const taskKey = (model: ModelId, questionId: string) => `${model}:${questionId}`;

/** Money is stored as whole micro-dollars, so Redis can add it up exactly. */
export const toMicros = (usd: number) => Math.max(0, Math.round(usd * 1_000_000));
export const fromMicros = (micros: number) => micros / 1_000_000;
