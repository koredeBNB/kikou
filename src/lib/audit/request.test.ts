import { describe, expect, it, vi } from "vitest";
import { auditInputFor, MAX_CITED, requestAudit, validateAuditRequest } from "@/lib/audit/request";
import type { AuditEvent, SiteAudit } from "@/lib/audit/types";
import { domainOf } from "@/lib/sov/citations";
import type { Brief } from "@/lib/sov/types";

const body = {
  site: "https://www.Thimble.studio/about",
  brand: "  Thimble ",
  category: "project tracker",
  audience: "small design studios",
  cited: [
    { url: "https://thimble.studio/docs", count: 3 },
    { url: "https://docs.thimble.studio/start", count: 1 },
    { url: "https://quiltboard.com/vs-thimble", count: 2 },
    { url: "javascript:alert(1)", count: 1 },
    { url: "https://thimble.studio/pricing", count: -1 },
  ],
};

describe("validateAuditRequest", () => {
  it("keeps the brand's domain and only the cited pages on it", () => {
    expect(validateAuditRequest(body)).toEqual({
      ok: true,
      value: {
        site: "thimble.studio",
        brand: "Thimble",
        category: "project tracker",
        audience: "small design studios",
        cited: [
          { url: "https://thimble.studio/docs", count: 3 },
          { url: "https://docs.thimble.studio/start", count: 1 },
        ],
      },
    });
  });

  it("caps the cited pages", () => {
    const cited = Array.from({ length: 40 }, (_, i) => ({ url: `https://thimble.studio/p${i}`, count: 1 }));
    const parsed = validateAuditRequest({ ...body, cited });
    expect(parsed.ok && parsed.value.cited).toHaveLength(MAX_CITED);
  });

  it.each([
    ["a body that isn't an object", "thimble.studio", "Expected a JSON body."],
    ["no website", { ...body, site: " " }, "Add your website to the brief so Pip knows which site to read."],
    ["a website that isn't a domain", { ...body, site: "localhost" }, "Add your website to the brief so Pip knows which site to read."],
    ["no brand", { ...body, brand: "" }, "Send the brand and its category."],
  ])("rejects %s", (_label, input, error) => {
    expect(validateAuditRequest(input)).toEqual({ ok: false, error });
  });
});

describe("auditInputFor", () => {
  const brief: Brief = {
    product: "Thimble",
    category: "project tracker",
    audience: "small design studios",
    competitors: ["Quiltboard"],
    website: "thimble.studio",
    otherSites: [],
    topics: [],
  };
  const answer = (urls: string[]) => ({ citationList: urls.map((url) => ({ url, domain: domainOf(url)! })) });

  it("counts how often the answers cited each of the brand's own pages", () => {
    const answers = [answer(["https://thimble.studio/docs", "https://quiltboard.com/x"]), answer(["https://www.thimble.studio/docs", "https://thimble.studio/"])];
    expect(auditInputFor(brief, answers)).toEqual({
      site: "thimble.studio",
      brand: "Thimble",
      category: "project tracker",
      audience: "small design studios",
      cited: [
        { url: "https://thimble.studio/docs", count: 2 },
        { url: "https://thimble.studio/", count: 1 },
      ],
    });
  });

  it("is null when the brief has no website", () => {
    expect(auditInputFor({ ...brief, website: "" }, [])).toBeNull();
  });
});

describe("requestAudit", () => {
  const input = { site: "thimble.studio", brand: "Thimble", category: "project tracker", cited: [] };
  const audit = { version: 1, site: "thimble.studio", score: 82, grade: "B" } as SiteAudit;
  const stream = (events: AuditEvent[], split = 7) => {
    const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
    const chunks = text.match(new RegExp(`[\\s\\S]{1,${split}}`, "g")) ?? [];
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
  };

  it("passes progress along and returns the finished audit", async () => {
    const events: AuditEvent[] = [
      { type: "step", step: "home", message: "Opening thimble.studio" },
      { type: "page", url: "https://thimble.studio/", done: 1, total: 4 },
      { type: "done", audit },
    ];
    const fetchImpl = vi.fn(async () => new Response(stream(events), { status: 200 }));
    const progress: AuditEvent[] = [];
    const result = await requestAudit(input, (e) => progress.push(e), { fetchImpl });
    expect(result).toEqual({ ok: true, audit });
    expect(progress.map((e) => e.type)).toEqual(["step", "page"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/audit");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("returns the error the audit ended with", async () => {
    const fetchImpl = vi.fn(async () => new Response(stream([{ type: "error", message: "Pip couldn't open thimble.studio." }]), { status: 200 }));
    expect(await requestAudit(input, () => {}, { fetchImpl })).toEqual({ ok: false, message: "Pip couldn't open thimble.studio." });
  });

  it("returns the server's refusal with its code", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "That's 20 site audits from here in the last hour.", code: "rate-limit" }, { status: 429 }));
    expect(await requestAudit(input, () => {}, { fetchImpl })).toEqual({ ok: false, message: "That's 20 site audits from here in the last hour.", code: "rate-limit" });
  });

  it("says so when the stream stops early or the server can't be reached", async () => {
    const early = vi.fn(async () => new Response(stream([{ type: "step", step: "home", message: "Opening" }]), { status: 200 }));
    expect(await requestAudit(input, () => {}, { fetchImpl: early })).toEqual({ ok: false, message: "The audit stopped before it finished. Try again." });
    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await requestAudit(input, () => {}, { fetchImpl: down })).toEqual({ ok: false, message: "Kioku couldn't reach its server. Check your connection and try again." });
  });
});
