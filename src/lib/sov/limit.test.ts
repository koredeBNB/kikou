import { describe, expect, it } from "vitest";
import { claimCheck, dailyCheckLimit, type CheckCounter } from "@/lib/sov/limit";

const at = (iso: string) => new Date(iso);
const counter = (): CheckCounter => ({ day: "", count: 0 });

describe("dailyCheckLimit", () => {
  it("reads SOV_MAX_CHECKS_PER_DAY as a positive whole number, otherwise no cap", () => {
    expect(dailyCheckLimit({})).toBeNull();
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: "" })).toBeNull();
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: "0" })).toBeNull();
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: "-3" })).toBeNull();
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: "lots" })).toBeNull();
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: " 25 " })).toBe(25);
    expect(dailyCheckLimit({ SOV_MAX_CHECKS_PER_DAY: "2.9" })).toBe(2);
  });
});

describe("claimCheck", () => {
  const env = { SOV_MAX_CHECKS_PER_DAY: "2" };

  it("allows checks up to the cap, then refuses with a friendly message", () => {
    const store = counter();
    const now = at("2026-10-26T19:00:00Z");
    expect(claimCheck(env, now, store)).toEqual({ ok: true, remaining: 1 });
    expect(claimCheck(env, now, store)).toEqual({ ok: true, remaining: 0 });
    const refused = claimCheck(env, now, store);
    expect(refused).toMatchObject({ ok: false, limit: 2, retryAfterSeconds: 5 * 3600 });
    expect(refused.ok === false && refused.message).toBe(
      "We've used all 2 Kioku checks for today, so I can't ask the assistants again just yet. The limit resets at midnight UTC, in about 5 hours. Your earlier reports are still saved.",
    );
    expect(store.count).toBe(2);
  });

  it("starts a fresh count on a new UTC day", () => {
    const store = counter();
    claimCheck(env, at("2026-10-26T22:00:00Z"), store);
    claimCheck(env, at("2026-10-26T23:00:00Z"), store);
    expect(claimCheck(env, at("2026-10-26T23:59:00Z"), store).ok).toBe(false);
    expect(claimCheck(env, at("2026-10-27T00:00:01Z"), store)).toEqual({ ok: true, remaining: 1 });
  });

  it("words the wait and a cap of one naturally", () => {
    const one = { SOV_MAX_CHECKS_PER_DAY: "1" };
    const store = counter();
    claimCheck(one, at("2026-10-26T23:30:00Z"), store);
    const refused = claimCheck(one, at("2026-10-26T23:30:00Z"), store);
    expect(refused.ok === false && refused.message).toBe(
      "We've used today's one Kioku check, so I can't ask the assistants again just yet. The limit resets at midnight UTC, in under an hour. Your earlier reports are still saved.",
    );
  });

  it("never refuses without a cap", () => {
    const store = counter();
    for (let i = 0; i < 50; i++) expect(claimCheck({}, at("2026-10-26T12:00:00Z"), store)).toEqual({ ok: true, remaining: null });
  });
});
