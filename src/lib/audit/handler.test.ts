import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "@/lib/audit/audit";
import { handleAudit } from "@/lib/audit/handler";
import type { AuditEvent } from "@/lib/audit/types";
import { createMemoryStore } from "@/lib/store/memory";

const HOME = `<!doctype html><html><head><title>Thimble</title></head><body><h1>Thimble</h1><p>${"word ".repeat(300)}</p></body></html>`;

const fakeSite: Fetcher = async (url) => {
  const ok = url === "https://thimble.studio/";
  return {
    ok: true,
    page: { url, status: ok ? 200 : 404, headers: {}, contentType: "text/html", body: ok ? HOME : "Not found", redirects: [], truncated: false },
  };
};

const body = { site: "thimble.studio", brand: "Thimble", category: "project tracker", cited: [] };

let visitor = 0;
const request = (payload: unknown, ip = `198.51.100.${++visitor}`) =>
  new Request("http://localhost/api/audit", {
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "content-type": "application/json", "x-real-ip": ip },
  });

async function events(response: Response): Promise<AuditEvent[]> {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("handleAudit", () => {
  it("streams the audit's progress and then the finished audit", async () => {
    const response = await handleAudit(request(body), { env: {}, store: createMemoryStore(), fetch: fakeSite });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    const sent = await events(response);
    expect(sent[0]).toEqual({ type: "step", step: "home", message: "Opening thimble.studio" });
    const done = sent.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.type === "done" && done.audit).toMatchObject({ version: 1, site: "thimble.studio", homepage: "https://thimble.studio/" });
  });

  it("ends with the reason when the site can't be read", async () => {
    const down: Fetcher = async (url) => ({ ok: false, reason: "network", message: "Kioku couldn't connect to the site.", url });
    const sent = await events(await handleAudit(request(body), { env: {}, store: createMemoryStore(), fetch: down }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "Pip couldn't open thimble.studio: couldn't connect to the site." });
  });

  it("ends with an apology when something unexpected breaks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: Fetcher = async () => {
      throw new Error("boom");
    };
    const sent = await events(await handleAudit(request(body), { env: {}, store: createMemoryStore(), fetch: broken }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "Pip tripped over something reading thimble.studio. Try again in a moment." });
  });

  it.each([
    ["a body that isn't JSON", "thimble.studio", 400],
    ["no website", { ...body, site: "" }, 400],
    ["an oversized body", { ...body, padding: "x".repeat(20_000) }, 413],
  ])("refuses %s", async (_label, payload, status) => {
    const response = await handleAudit(request(payload), { env: {}, store: createMemoryStore(), fetch: fakeSite });
    expect(response.status).toBe(status);
    expect(typeof (await response.json()).error).toBe("string");
  });

  it("allows 20 audits an hour per visitor", async () => {
    const store = createMemoryStore();
    const ip = "203.0.113.9";
    for (let i = 0; i < 20; i++) await (await handleAudit(request({ ...body, site: `site${i}.example` }, ip), { env: {}, store, fetch: fakeSite })).text();
    const refused = await handleAudit(request(body, ip), { env: {}, store, fetch: fakeSite });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect(await refused.json()).toMatchObject({ code: "rate-limit" });
  });

  it("allows 30 audits of one site an hour from everyone together", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 30; i++) await (await handleAudit(request(body), { env: {}, store, fetch: fakeSite })).text();
    const refused = await handleAudit(request(body), { env: {}, store, fetch: fakeSite });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "site-limit" });
  });
});
