import { PER_MODEL_CONCURRENCY } from "@/lib/sov/estimate";
import { MAX_BATCH, type BatchEvent, type TaskRef } from "@/lib/sov/events";
import type { ModelId } from "@/lib/sov/types";
import type { TaskResult } from "@/lib/store/types";

export type SendBatch = (tasks: TaskRef[], onEvent: (event: BatchEvent) => void, signal: AbortSignal) => Promise<void>;

/** Codes that mean no later batch can succeed either, so the check stops instead of retrying. */
const FINAL_CODES = new Set(["daily-budget", "run-missing"]);

/** A batch request the server answered with an error. `code` is set when the whole check has to stop. */
export class BatchError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BatchError";
  }
}

export const DROPPED = "The connection dropped before this answer arrived.";

export interface DriveOptions {
  models: ModelId[];
  questionIds: string[];
  send: SendBatch;
  onResult: (result: TaskResult) => void;
  signal: AbortSignal;
  /** Answers in flight at once for each assistant. */
  perModel?: number;
  maxBatch?: number;
  /** How long to wait after an answer lands, so slots that free up together share one request. */
  gatherMs?: number;
  /** Times an answer is asked for again after its request dropped. */
  retries?: number;
  retryDelayMs?: number;
}

export interface DriveOutcome {
  /** Set when the server stopped the check, for example because today's budget ran out. */
  stopped?: { message: string; code: string };
}

/**
 * Asks for every answer of a check in small batch requests. Each assistant keeps up to `perModel` answers in
 * flight, so a slow assistant never holds up the others, and no single request runs for long.
 */
export function driveCheck(options: DriveOptions): Promise<DriveOutcome> {
  const { models, questionIds, send, onResult, signal } = options;
  const perModel = Math.max(1, options.perModel ?? PER_MODEL_CONCURRENCY);
  const maxBatch = Math.max(1, options.maxBatch ?? MAX_BATCH);
  const gatherMs = options.gatherMs ?? 300;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 1500;

  type Item = { id: string; tries: number };
  const lanes = new Map(models.map((model) => [model, { queue: questionIds.map((id): Item => ({ id, tries: 0 })), inFlight: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }]));
  let unresolved = models.length * questionIds.length;
  let stopped: DriveOutcome["stopped"];

  return new Promise<DriveOutcome>((resolve) => {
    const end = () => {
      for (const lane of lanes.values()) clearTimeout(lane.timer);
      signal.removeEventListener("abort", end);
      resolve(stopped ? { stopped } : {});
    };

    const settle = (result: TaskResult) => {
      unresolved--;
      onResult(result);
      if (unresolved === 0) end();
    };

    const pump = (model: ModelId) => {
      const lane = lanes.get(model)!;
      lane.timer = undefined;
      if (signal.aborted) return;
      while (lane.inFlight < perModel && lane.queue.length) {
        const items = lane.queue.splice(0, Math.min(perModel - lane.inFlight, maxBatch));
        lane.inFlight += items.length;
        void dispatch(model, items);
      }
    };

    const later = (model: ModelId, ms: number) => {
      const lane = lanes.get(model)!;
      if (lane.timer === undefined) lane.timer = setTimeout(() => pump(model), ms);
    };

    const stop = (message: string, code: string) => {
      if (stopped) return;
      stopped = { message, code };
      for (const [model, lane] of lanes) for (const item of lane.queue.splice(0)) settle({ type: "error", model, questionId: item.id, message });
    };

    const dispatch = async (model: ModelId, items: Item[]) => {
      const lane = lanes.get(model)!;
      const pending = new Map(items.map((item) => [item.id, item]));
      let failure = DROPPED;
      try {
        await send(
          items.map((item) => ({ model, questionId: item.id })),
          (event) => {
            if (event.type === "ping" || signal.aborted) return;
            const id = event.type === "answer" ? event.answer.questionId : event.questionId;
            if (!pending.delete(id)) return;
            lane.inFlight--;
            settle(event);
            if (!stopped) later(model, gatherMs);
          },
          signal,
        );
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof BatchError) {
          failure = error.message;
          if (error.code && FINAL_CODES.has(error.code)) stop(error.message, error.code);
        }
      }
      if (signal.aborted || pending.size === 0) return;
      const again: Item[] = [];
      for (const item of pending.values()) {
        lane.inFlight--;
        if (stopped || item.tries >= retries) settle({ type: "error", model, questionId: item.id, message: stopped?.message ?? failure });
        else again.push({ id: item.id, tries: item.tries + 1 });
      }
      if (again.length) {
        lane.queue.unshift(...again);
        later(model, retryDelayMs);
      }
    };

    if (unresolved === 0 || signal.aborted) return end();
    signal.addEventListener("abort", end);
    for (const model of models) pump(model);
  });
}

/** Reads a response body of newline-separated JSON, calling `onLine` for each value as it arrives. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(JSON.parse(line));
      newline = buffer.indexOf("\n");
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) onLine(JSON.parse(rest));
}

/** Sends one batch to `/api/check/[id]/batch` and streams its answers back. */
export function batchSender(runId: string, fetchImpl: typeof fetch = fetch): SendBatch {
  return async (tasks, onEvent, signal) => {
    const response = await fetchImpl(`/api/check/${encodeURIComponent(runId)}/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
      const message = typeof body.error === "string" ? body.error : `The check couldn't continue (${response.status}).`;
      throw new BatchError(message, typeof body.code === "string" ? body.code : undefined);
    }
    await readNdjson(response.body, (value) => onEvent(value as BatchEvent));
  };
}
