import { describe, expect, it, vi } from "vitest";
import { hourlyLimit, rateLimit, visitorId } from "@/lib/sov/rate-limit";
import { createMemoryStore } from "@/lib/store/memory";
import type { CheckStore } from "@/lib/store/types";

describe("hourlyLimit", () => {
  it("allows 12 checks an hour by default, or SOV_CHECKS_PER_HOUR, with fixed limits for plans, intake and lookups", () => {
    expect(hourlyLimit({}, "check")).toBe(12);
    expect(hourlyLimit({ SOV_CHECKS_PER_HOUR: "30" }, "check")).toBe(30);
    expect(hourlyLimit({ SOV_CHECKS_PER_HOUR: "lots" }, "check")).toBe(12);
    expect(hourlyLimit({ SOV_CHECKS_PER_HOUR: "30" }, "questions")).toBe(30);
    expect(hourlyLimit({}, "intake")).toBe(150);
    expect(hourlyLimit({}, "lookup")).toBe(20);
  });

  it("can be switched off for everything", () => {
    for (const bucket of ["check", "questions", "intake", "lookup"] as const) expect(hourlyLimit({ SOV_CHECKS_PER_HOUR: "off" }, bucket)).toBeNull();
  });
});

describe("visitorId", () => {
  it("uses the address Vercel reports, then the first forwarded one", () => {
    expect(visitorId(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(visitorId(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(visitorId(new Headers())).toBe("local");
  });
});

describe("rateLimit", () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.7" });

  it("refuses once a visitor is over the hour's limit, saying when to come back", async () => {
    const store = createMemoryStore();
    const env = { SOV_CHECKS_PER_HOUR: "1" };
    const now = Date.now();
    expect(await rateLimit(env, store, "check", headers, now)).toBeNull();
    const refused = await rateLimit(env, store, "check", headers, now + 20 * 60_000);
    expect(refused).toEqual({
      retryAfterSeconds: 40 * 60,
      message: "That's 1 check from here in the last hour, so I'm taking a short breather. Try again in about 40 minutes. Your earlier reports are still saved.",
    });
    expect(await rateLimit(env, store, "check", headers, now + 61 * 60_000)).toBeNull();
  });

  it("lets requests through when the store can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { hit: async () => Promise.reject(new Error("down")) } as unknown as CheckStore;
    expect(await rateLimit({}, broken, "check", headers)).toBeNull();
  });
});
