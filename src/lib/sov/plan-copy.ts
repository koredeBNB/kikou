import { listJoin } from "@/lib/format";

const BUILT_IN = 6;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Pip's line while the question writer works, or null when the built-in questions cover it. */
export function writingMessage({ count, topics = [] }: { count: number; topics?: string[] }): string | null {
  if (topics.length === 0 && count <= BUILT_IN) return null;
  const across = topics.length ? ` across ${listJoin(topics)}` : "";
  return `Give me a moment to write ${plural(count, "buyer question")}${across}…`;
}

export function planMessage({ product, questions, requested, topics = [] }: { product: string; questions: number; requested: number; topics?: string[] }): string {
  const intro = topics.length
    ? `Here's my plan: ${plural(questions, "question")} split evenly across ${listJoin(topics)}, the way a real buyer would ask them.`
    : `Here's my plan. I'll ask each assistant these ${plural(questions, "question")}, the way a real buyer would.`;
  const short =
    questions < requested
      ? ` I could only come up with ${questions} distinct question${questions === 1 ? "" : "s"}, not ${requested}, so I'll ask ${questions === 1 ? "that" : "those"}.`
      : "";
  return `${intro} None of them name **${product}**, so every recommendation is unprompted.${short}`;
}
