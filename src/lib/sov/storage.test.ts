import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INDEX_KEY, listRuns, loadRun, runKey, saveRun, type StoredRun } from "@/lib/sov/storage";

/** A localStorage stand-in that throws like a browser once `quota` characters are stored. */
function fakeStorage(quota: number) {
  const items = new Map<string, string>();
  const used = () => [...items].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const before = items.get(key);
      items.set(key, value);
      if (used() > quota) {
        if (before === undefined) items.delete(key);
        else items.set(key, before);
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

const run = (id: string, size: number): StoredRun => ({
  id,
  createdAt: "2026-10-26T12:00:00.000Z",
  brief: { product: `P-${id}`, category: "crypto wallet", audience: "", competitors: [] },
  questions: [],
  models: [],
  answers: [{ questionId: "q1", model: "claude", text: "x".repeat(size), citations: [], source: "live", latencyMs: 1 }],
  errors: [],
  elapsedMs: 1,
});

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage(10_000);
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

describe("saveRun", () => {
  it("saves a run and lists it first", () => {
    expect(saveRun(run("a", 100))).toBe(true);
    expect(saveRun(run("b", 100))).toBe(true);
    expect(listRuns().map((r) => r.id)).toEqual(["b", "a"]);
    expect(loadRun("a")?.brief.product).toBe("P-a");
  });

  it("makes room for a big run by removing the oldest reports", () => {
    saveRun(run("old", 3000));
    saveRun(run("mid", 3000));
    saveRun(run("new", 2000));
    expect(saveRun(run("big", 5000))).toBe(true);
    expect(listRuns().map((r) => r.id)).toEqual(["big", "new"]);
    expect(storage.items.has(runKey("old"))).toBe(false);
    expect(storage.items.has(runKey("mid"))).toBe(false);
    expect(loadRun("big")?.answers[0].text).toHaveLength(5000);
  });

  it("keeps a run that can't fit in memory so its report still opens in this tab", () => {
    saveRun(run("keep", 100));
    expect(saveRun(run("huge", 20_000))).toBe(false);
    expect(loadRun("huge")?.brief.product).toBe("P-huge");
    expect(listRuns().map((r) => r.id)).toEqual(["keep"]);
    expect(JSON.parse(storage.getItem(INDEX_KEY) ?? "[]")).toHaveLength(1);
  });
});
