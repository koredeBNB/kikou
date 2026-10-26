import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/lib/sov/events";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import { runCheck } from "@/lib/sov/run";
import { MODEL_IDS } from "@/lib/sov/types";

const brief = normalizeBrief({ product: "Acme", category: "CRM", audience: "small agencies", competitors: ["Close"] });
const questions = generateQuestions(brief, { year: 2026 }).slice(0, 3);
const noDelay = async () => {};

async function collect(options: Partial<Parameters<typeof runCheck>[0]> = {}) {
  const events: RunEvent[] = [];
  await runCheck(
    { brief, questions, models: [...MODEL_IDS], env: {}, delay: noDelay, ...options },
    (event) => events.push(event),
  );
  return events;
}

describe("runCheck", () => {
  it("streams a start event, one answer per question and model, then done", async () => {
    const events = await collect();
    expect(events[0]).toMatchObject({ type: "start", total: 12 });
    const start = events[0] as Extract<RunEvent, { type: "start" }>;
    expect(start.models.every((m) => m.source === "mock")).toBe(true);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(12);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("only asks the selected models", async () => {
    const events = await collect({ models: ["claude"] });
    const answers = events.filter((e) => e.type === "answer");
    expect(answers).toHaveLength(3);
    expect(answers.every((e) => e.type === "answer" && e.answer.model === "claude")).toBe(true);
  });

  it("reports provider failures per answer and keeps going", async () => {
    const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const events = await collect({ env: { OPENAI_API_KEY: "sk-test" }, fetchImpl: failing });
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.type === "error" && e.model === "chatgpt" && e.message.includes("500"))).toBe(true);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(9);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("marks live answers as live", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Try **Acme**." } }], citations: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const events = await collect({ env: { PERPLEXITY_API_KEY: "p" }, fetchImpl: ok, models: ["perplexity"] });
    const answer = events.find((e) => e.type === "answer");
    expect(answer?.type === "answer" && answer.answer.source).toBe("live");
  });
});
