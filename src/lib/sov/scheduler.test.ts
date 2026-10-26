import { describe, expect, it } from "vitest";
import type { TaskRef } from "@/lib/sov/events";
import { batchSender, BatchError, driveCheck, DROPPED, readNdjson, type SendBatch } from "@/lib/sov/scheduler";
import type { ModelId } from "@/lib/sov/types";
import type { TaskResult } from "@/lib/store/types";

const answerFor = ({ model, questionId }: TaskRef): TaskResult => ({
  type: "answer",
  answer: { model, questionId, text: "ok", citations: [], source: "mock", latencyMs: 1 },
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => `q${i + 1}`);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function drive(send: SendBatch, { models = ["claude", "gemini"] as ModelId[], questions = 7, ...rest }: Partial<Parameters<typeof driveCheck>[0]> & { questions?: number } = {}) {
  const results: TaskResult[] = [];
  const signal = rest.signal ?? new AbortController().signal;
  const outcome = driveCheck({ models, questionIds: ids(questions), send, onResult: (r) => results.push(r), signal, gatherMs: 0, retryDelayMs: 0, ...rest });
  return { results, outcome };
}

describe("driveCheck", () => {
  it("asks for every answer once, keeping a few in flight per assistant and the assistants side by side", async () => {
    const inFlight: Record<string, number> = {};
    const peak: Record<string, number> = {};
    let overallPeak = 0;
    const batches: TaskRef[][] = [];
    const send: SendBatch = async (tasks, onEvent) => {
      batches.push(tasks);
      await Promise.all(
        tasks.map(async (task, i) => {
          inFlight[task.model] = (inFlight[task.model] ?? 0) + 1;
          peak[task.model] = Math.max(peak[task.model] ?? 0, inFlight[task.model]);
          overallPeak = Math.max(overallPeak, Object.values(inFlight).reduce((a, b) => a + b, 0));
          await pause(3 + i);
          inFlight[task.model]--;
          onEvent(answerFor(task));
        }),
      );
    };
    const { results, outcome } = drive(send, { perModel: 3, questions: 8 });
    expect(await outcome).toEqual({});
    expect(results).toHaveLength(16);
    expect(new Set(results.map((r) => r.type === "answer" && `${r.answer.model}:${r.answer.questionId}`)).size).toBe(16);
    expect(Object.values(peak).every((n) => n <= 3)).toBe(true);
    expect(overallPeak).toBeGreaterThan(3);
    expect(batches.slice(0, 2).map((b) => b.length)).toEqual([3, 3]);
    expect(batches.every((b) => new Set(b.map((t) => t.model)).size === 1)).toBe(true);
  });

  it("asks again once for answers a dropped request didn't deliver, then lists them as failed", async () => {
    const asked: string[] = [];
    const send: SendBatch = async (tasks, onEvent) => {
      for (const task of tasks) asked.push(task.questionId);
      if (tasks[0].questionId === "q1") {
        onEvent(answerFor(tasks[0]));
        throw new TypeError("network error");
      }
      for (const task of tasks) onEvent(answerFor(task));
    };
    const { results, outcome } = drive(send, { models: ["claude"], questions: 3, perModel: 3 });
    await outcome;
    expect(asked).toEqual(["q1", "q2", "q3", "q2", "q3"]);
    expect(results.filter((r) => r.type === "answer")).toHaveLength(3);

    const failing: SendBatch = async () => {
      throw new TypeError("network error");
    };
    const second = drive(failing, { models: ["claude"], questions: 2 });
    await second.outcome;
    expect(second.results).toEqual([
      { type: "error", model: "claude", questionId: "q1", message: DROPPED },
      { type: "error", model: "claude", questionId: "q2", message: DROPPED },
    ]);
  });

  it("passes on the server's reason when a batch keeps failing", async () => {
    const send: SendBatch = async () => {
      throw new BatchError("Kioku couldn't reach its storage just now. Try again in a moment.");
    };
    const { results, outcome } = drive(send, { models: ["claude"], questions: 1 });
    await outcome;
    expect(results).toEqual([{ type: "error", model: "claude", questionId: "q1", message: "Kioku couldn't reach its storage just now. Try again in a moment." }]);
  });

  it("stops the whole check when the server says today's budget is gone", async () => {
    let calls = 0;
    const send: SendBatch = async (tasks, onEvent) => {
      calls++;
      if (calls > 2) throw new BatchError("We've spent today's $20.00 budget.", "daily-budget");
      for (const task of tasks) onEvent(answerFor(task));
    };
    const { results, outcome } = drive(send, { questions: 10, perModel: 2 });
    expect(await outcome).toEqual({ stopped: { message: "We've spent today's $20.00 budget.", code: "daily-budget" } });
    expect(results).toHaveLength(20);
    expect(results.filter((r) => r.type === "answer")).toHaveLength(4);
    expect(results.filter((r) => r.type === "error").every((r) => r.type === "error" && r.message === "We've spent today's $20.00 budget.")).toBe(true);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("stops asking as soon as it's aborted", async () => {
    const abort = new AbortController();
    let calls = 0;
    const send: SendBatch = async (_tasks, _onEvent, signal) => {
      calls++;
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    };
    const { results, outcome } = drive(send, { signal: abort.signal, questions: 20 });
    await pause(5);
    abort.abort();
    await outcome;
    expect(calls).toBe(2);
    expect(results).toEqual([]);
  });

  it("finishes straight away when there's nothing to ask", async () => {
    const { outcome } = drive(async () => {}, { questions: 0 });
    expect(await outcome).toEqual({});
  });
});

describe("batchSender and readNdjson", () => {
  it("streams each line of a batch response as it arrives, including a last line without a newline", async () => {
    const encoder = new TextEncoder();
    const chunks = ['{"type":"ping"}\n{"type":"answer","answer":', '{"questionId":"q1"}}\n{"type":"err', 'or","questionId":"q2"}'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const seen: unknown[] = [];
    await readNdjson(body, (value) => seen.push(value));
    expect(seen).toEqual([{ type: "ping" }, { type: "answer", answer: { questionId: "q1" } }, { type: "error", questionId: "q2" }]);
  });

  it("posts the tasks to the run's batch route and turns refusals into a BatchError with the code", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const refuse = (async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ error: "This check has expired.", code: "run-missing" }, { status: 404 });
    }) as unknown as typeof fetch;
    const send = batchSender("abc123", refuse);
    const error = await send([{ model: "claude", questionId: "q1" }], () => {}, new AbortController().signal).catch((e) => e);
    expect(requests).toEqual([{ url: "/api/check/abc123/batch", body: { tasks: [{ model: "claude", questionId: "q1" }] } }]);
    expect(error).toBeInstanceOf(BatchError);
    expect(error).toMatchObject({ message: "This check has expired.", code: "run-missing" });
  });
});
