import { mockAnswer } from "@/lib/sov/mock";
import { generateQuestions } from "@/lib/sov/questions";
import type { StoredRun } from "@/lib/sov/storage";
import { MODEL_IDS, MODEL_LABELS, type Brief } from "@/lib/sov/types";

export const DEMO_RUN_ID = "demo";

/** A fictional product so the sample report never makes claims about real brands. */
export const DEMO_BRIEF: Brief = {
  product: "Thimble",
  category: "project tracker",
  audience: "small design studios",
  competitors: ["Quiltboard", "Patchwork"],
  website: "thimble.studio",
};

export function buildDemoRun(now: Date = new Date()): StoredRun {
  const questions = generateQuestions(DEMO_BRIEF, { year: now.getFullYear() });
  const answers = questions.flatMap((q) => MODEL_IDS.map((model) => mockAnswer(DEMO_BRIEF, q, model)));
  return {
    id: DEMO_RUN_ID,
    createdAt: now.toISOString(),
    brief: DEMO_BRIEF,
    questions,
    models: MODEL_IDS.map((id) => ({ id, label: MODEL_LABELS[id], source: "mock" })),
    answers,
    errors: [],
    elapsedMs: Math.max(...answers.map((a) => a.latencyMs)),
  };
}
