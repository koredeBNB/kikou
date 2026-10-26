import { describe, expect, it } from "vitest";
import { listJoin, ordinal, pct, rankLabel } from "@/lib/format";

describe("format helpers", () => {
  it("formats percentages, ranks, ordinals and lists", () => {
    expect(pct(0.456)).toBe("46%");
    expect(rankLabel(2)).toBe("#2");
    expect(rankLabel(2.25)).toBe("#2.3");
    expect(rankLabel(null)).toBe("—");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
    expect(listJoin(["A"])).toBe("A");
    expect(listJoin(["A", "B", "C"])).toBe("A, B and C");
  });
});
