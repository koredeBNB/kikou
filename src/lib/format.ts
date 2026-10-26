export const pct = (value: number) => `${Math.round(value * 100)}%`;

export const rankLabel = (rank: number | null) => (rank === null ? "—" : `#${rank.toFixed(rank % 1 === 0 ? 0 : 1)}`);

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
