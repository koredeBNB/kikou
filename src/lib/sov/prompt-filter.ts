import type { PromptRow } from "@/lib/sov/types";

export const PROMPTS_PER_PAGE = 20;

export type PromptStatus = "all" | "missing" | "named";

export interface PromptFilter {
  status: PromptStatus;
  topic?: string | null;
}

export function filterPrompts(rows: PromptRow[], { status, topic }: PromptFilter): PromptRow[] {
  return rows.filter((row) => {
    if (topic && row.question.topic !== topic) return false;
    if (status === "missing") return row.productMentions < row.answers;
    if (status === "named") return row.productMentions > 0;
    return true;
  });
}

export function pageOf<T>(items: T[], page: number, size = PROMPTS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * size;
  return { items: items.slice(start, start + size), page: current, pages, start };
}
