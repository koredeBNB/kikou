import type { QuestionIntent } from "@/lib/sov/types";

export const pct = (value: number) => `${Math.round(value * 100)}%`;

export const rankLabel = (rank: number | null) => (rank === null ? "—" : `#${rank.toFixed(rank % 1 === 0 ? 0 : 1)}`);

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function listJoin(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

export const INTENT_LABELS: Record<QuestionIntent, string> = {
  "best-for": "Best for you",
  "top-list": "Top picks",
  alternatives: "Alternatives",
  budget: "Budget",
  switching: "Switching",
  features: "Features",
  comparison: "Comparison",
  beginner: "Beginners",
  "use-case": "Use case",
  custom: "Your question",
};
