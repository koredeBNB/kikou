import { describe, expect, it } from "vitest";
import type { FetchResult, SafeFetchOptions } from "@/lib/audit/safe-fetch";
import { readBrandSite, readBrandSites, type SiteFetcher } from "@/lib/intake/site";

type Answer = { status: number; body?: string; type?: string; url?: string } | "down";

function site(routes: Record<string, Answer>): { fetch: SiteFetcher; calls: { url: string; options: SafeFetchOptions }[] } {
  const calls: { url: string; options: SafeFetchOptions }[] = [];
  const fetch: SiteFetcher = async (url, options): Promise<FetchResult> => {
    calls.push({ url, options });
    const answer = routes[url] ?? { status: 404, body: "Not found", type: "text/html" };
    if (answer === "down") return { ok: false, reason: "network", message: "Kioku couldn't connect to the site.", url };
    return {
      ok: true,
      page: { url: answer.url ?? url, status: answer.status, headers: {}, contentType: answer.type ?? "text/html", body: answer.body ?? "", redirects: [], truncated: false },
    };
  };
  return { fetch, calls };
}

const HOME = `<html><head><title>fomo | Social Crypto Trading App</title><meta name="description" content="Trade memecoins and copy top traders."></head>
<body><nav>Menu Login</nav><h1>where traders become legends</h1><p>join 2,500,000 traders</p></body></html>`;

describe("readBrandSite", () => {
  it("checks robots.txt as KiokuBot, then reads what the homepage says about the brand", async () => {
    const { fetch, calls } = site({
      "https://fomo.family/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /admin", type: "text/plain" },
      "https://fomo.family/": { status: 200, body: HOME, url: "https://www.fomo.family/" },
    });
    expect(await readBrandSite("fomo.family", fetch)).toEqual({
      site: "fomo.family",
      url: "https://www.fomo.family/",
      title: "fomo | Social Crypto Trading App",
      description: "Trade memecoins and copy top traders.",
      headings: ["where traders become legends"],
      text: "where traders become legends join 2,500,000 traders",
    });
    expect(calls.map((c) => c.url)).toEqual(["https://fomo.family/robots.txt", "https://fomo.family/"]);
    for (const call of calls) {
      expect(call.options.userAgent).toMatch(/KiokuBot/);
      expect(call.options.timeoutMs).toBeLessThanOrEqual(4000);
    }
  });

  it("reads a site with no robots.txt", async () => {
    const { fetch } = site({ "https://fomo.family/": { status: 200, body: HOME } });
    expect(await readBrandSite("fomo.family", fetch)).toMatchObject({ title: "fomo | Social Crypto Trading App" });
  });

  it.each([
    ["robots.txt closes the site to every crawler", "User-agent: *\nDisallow: /"],
    ["robots.txt closes the site to KiokuBot", "User-agent: KiokuBot\nDisallow: /"],
  ])("stays out when %s", async (_label, robots) => {
    const { fetch, calls } = site({ "https://fomo.family/robots.txt": { status: 200, body: robots, type: "text/plain" }, "https://fomo.family/": { status: 200, body: HOME } });
    expect(await readBrandSite("fomo.family", fetch)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("stays out when robots.txt doesn't load, as RFC 9309 says", async () => {
    const { fetch, calls } = site({ "https://fomo.family/robots.txt": { status: 503 }, "https://fomo.family/": { status: 200, body: HOME } });
    expect(await readBrandSite("fomo.family", fetch)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it.each<[string, Answer]>([
    ["refuses Kioku", { status: 403, body: HOME }],
    ["isn't a web page", { status: 200, body: "{}", type: "application/json" }],
    ["can't be reached", "down"],
    ["says nothing at all", { status: 200, body: "<html><body></body></html>" }],
  ])("gives nothing back when the homepage %s", async (_label, answer) => {
    const { fetch } = site({ "https://fomo.family/": answer });
    expect(await readBrandSite("fomo.family", fetch)).toBeNull();
  });
});

describe("readBrandSites", () => {
  it("reads at most two sites at once and leaves out the ones it couldn't read", async () => {
    const { fetch, calls } = site({
      "https://fomo.family/": { status: 200, body: HOME },
      "https://fomo.blog/": "down",
      "https://fomo.app/": { status: 200, body: HOME },
    });
    const read = await readBrandSites(["fomo.family", "fomo.blog", "fomo.app"], fetch);
    expect(read.map((s) => s.site)).toEqual(["fomo.family"]);
    expect(calls.some((c) => c.url.startsWith("https://fomo.app"))).toBe(false);
  });

  it("never throws, even when the fetcher does", async () => {
    const broken: SiteFetcher = async () => {
      throw new Error("boom");
    };
    expect(await readBrandSites(["fomo.family"], broken)).toEqual([]);
  });
});
