import { describe, expect, it } from "vitest";
import { maxDuration, POST } from "@/app/api/audit/route";

describe("POST /api/audit", () => {
  it("validates the request before reading anything", async () => {
    const response = await POST(
      new Request("http://localhost/api/audit", { method: "POST", body: JSON.stringify({ brand: "Thimble", category: "project tracker" }), headers: { "x-real-ip": "198.51.100.200" } }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Add your website to the brief so Pip knows which site to read." });
  });

  it("gives the audit a minute", () => {
    expect(maxDuration).toBe(60);
  });
});
