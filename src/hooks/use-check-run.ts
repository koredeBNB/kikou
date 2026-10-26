"use client";

import { useCallback, useRef, useState } from "react";
import type { ProviderStatus } from "@/lib/providers/config";
import type { CheckRequest, RunEvent } from "@/lib/sov/events";
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
  failure?: string;
  /** The server refused the check because it would go over today's budget; `failure` holds its message. */
  limited?: boolean;
}

const INITIAL: RunState = { status: "idle", models: [], answers: [], errors: [], total: 0, elapsedMs: 0 };

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

      try {
        const response = await fetch("/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          if (body.code === "daily-budget" && typeof body.error === "string") {
            update({ ...current, status: "failed", failure: body.error, limited: true });
            onFinish?.(current, request);
            return;
          }
          throw new Error(body.error ?? `The check couldn't start (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (event: RunEvent) => {
          switch (event.type) {
            case "start":
              update({ ...current, models: event.models, total: event.total });
              break;
            case "answer":
              update({ ...current, answers: [...current.answers, event.answer] });
              break;
            case "error":
              update({ ...current, errors: [...current.errors, { model: event.model, questionId: event.questionId, message: event.message }] });
              break;
            case "done":
              update({ ...current, status: "done", elapsedMs: event.elapsedMs });
              break;
          }
        };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handle(JSON.parse(line) as RunEvent);
            newline = buffer.indexOf("\n");
          }
        }
        if (current.status !== "done") {
          update({ ...current, status: current.answers.length ? "done" : "failed", failure: current.answers.length ? undefined : "The connection closed before any answers arrived." });
        }
        onFinish?.(current, request);
      } catch (error) {
        if (abort.signal.aborted) return;
        update({ ...current, status: "failed", failure: error instanceof Error ? error.message : "Something went wrong." });
        onFinish?.(current, request);
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
