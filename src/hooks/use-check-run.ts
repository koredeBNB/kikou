"use client";

import { useCallback, useRef, useState } from "react";
import type { ProviderStatus } from "@/lib/providers/config";
import type { CheckRequest, CheckStarted } from "@/lib/sov/events";
import { batchSender, driveCheck } from "@/lib/sov/scheduler";
import type { RunError } from "@/lib/sov/storage";
import type { ModelAnswer } from "@/lib/sov/types";

export type RunStatus = "idle" | "running" | "done" | "failed";

export interface RunState {
  status: RunStatus;
  models: ProviderStatus[];
  answers: ModelAnswer[];
  errors: RunError[];
  total: number;
  elapsedMs: number;
  /** When the server started answering, for the time-left estimate. */
  startedAt?: number;
  failure?: string;
  /** The server refused the check (today's budget, or too many checks from here); `failure` holds its message. */
  limited?: boolean;
}

const INITIAL: RunState = { status: "idle", models: [], answers: [], errors: [], total: 0, elapsedMs: 0 };
const LIMIT_CODES = new Set(["daily-budget", "rate-limit"]);

/** Gives the check's unused budget hold back. `keepalive` lets it finish even as the page closes. */
function finishRun(runId: string) {
  void fetch(`/api/check/${encodeURIComponent(runId)}/finish`, { method: "POST", keepalive: true }).catch(() => {});
}

export function useCheckRun(onFinish?: (state: RunState, request: CheckRequest) => void) {
  const [state, setState] = useState<RunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (request: CheckRequest) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      let current: RunState = { ...INITIAL, status: "running", total: request.questions.length * (request.models?.length ?? 4) };
      const update = (next: RunState) => {
        current = next;
        setState(next);
      };
      update(current);

      let runId: string | undefined;
      try {
        const response = await fetch("/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: abort.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (LIMIT_CODES.has(body.code) && typeof body.error === "string") {
            update({ ...current, status: "failed", failure: body.error, limited: true });
            onFinish?.(current, request);
            return;
          }
          throw new Error(body.error ?? `The check couldn't start (${response.status}).`);
        }

        const started = (await response.json()) as CheckStarted;
        runId = started.runId;
        const startedAt = Date.now();
        update({ ...current, models: started.models, total: started.total, startedAt });

        const outcome = await driveCheck({
          models: started.models.map((m) => m.id),
          questionIds: request.questions.map((q) => q.id),
          send: batchSender(started.runId),
          signal: abort.signal,
          onResult: (result) => {
            if (result.type === "answer") update({ ...current, answers: [...current.answers, result.answer] });
            else update({ ...current, errors: [...current.errors, { model: result.model, questionId: result.questionId, message: result.message }] });
          },
        });
        if (abort.signal.aborted) return;

        const elapsedMs = Date.now() - startedAt;
        if (current.answers.length) {
          update({ ...current, status: "done", elapsedMs });
        } else if (outcome.stopped && LIMIT_CODES.has(outcome.stopped.code)) {
          update({ ...current, status: "failed", elapsedMs, failure: outcome.stopped.message, limited: true });
        } else {
          update({ ...current, status: "failed", elapsedMs, failure: outcome.stopped?.message ?? current.errors[0]?.message ?? "No answers came back." });
        }
        onFinish?.(current, request);
      } catch (error) {
        if (abort.signal.aborted) return;
        update({ ...current, status: "failed", failure: error instanceof Error ? error.message : "Something went wrong." });
        onFinish?.(current, request);
      } finally {
        if (runId) finishRun(runId);
      }
    },
    [onFinish],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, start, reset };
}
