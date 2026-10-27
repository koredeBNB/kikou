import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, isPublicAddress, safeFetch } from "@/lib/audit/safe-fetch";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "104.16.132.229", "2606:4700::6810:84e5", "2a00:1450:4009:81f::200e"])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.8",
    "172.16.4.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("checkUrl", () => {
  it("accepts plain http and https on the usual ports", () => {
    expect(checkUrl("https://thimble.studio/pricing").ok).toBe(true);
    expect(checkUrl("http://thimble.studio:80/").ok).toBe(true);
    expect(checkUrl("https://thimble.studio:443/").ok).toBe(true);
  });

  it.each([
    ["ftp://thimble.studio/", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["https://thimble.studio:8443/", "port"],
    ["https://user:pass@thimble.studio/", "credentials"],
    ["http://127.0.0.1/", "address"],
    ["http://[::1]/", "address"],
    ["http://169.254.169.254/latest/meta-data", "address"],
    ["http://localhost/", "host"],
    ["http://printer.local/", "host"],
    ["http://intranet/", "host"],
    ["not a url", "url"],
  ])("refuses %s", (url, reason) => {
    const result = checkUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });
});

describe("safeFetch", () => {
  let server: Server;
  let base: string;
  const open = { address: () => true, port: () => true };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const ua = req.headers["user-agent"] ?? "";
      if (req.url === "/hello") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" });
        res.end(`<p>Hello ${ua}</p>`);
      } else if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(gzipSync("squeezed text"));
      } else if (req.url === "/hop") {
        res.writeHead(301, { location: "/hello" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
      } else if (req.url === "/escape") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(50_000));
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 2_000);
      } else {
        res.writeHead(404);
        res.end("nope");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("refuses private addresses with the default guard", async () => {
    const result = await safeFetch(`${base}/hello`, { userAgent: "KiokuBot/1.0" });
    expect(result).toMatchObject({ ok: false, reason: "address" });
  });

  it("refuses hosts that resolve to private addresses", async () => {
    const result = await safeFetch("http://localhost.example.invalid/", { userAgent: "KiokuBot/1.0" }, {
      guard: { port: () => true },
      lookup: (_host, _options, callback) => callback(null, [{ address: "10.1.2.3", family: 4 }]),
    });
    expect(result).toMatchObject({ ok: false, reason: "address" });
  });

  it("sends the user agent and returns the body, status and headers", async () => {
    const result = await safeFetch(`${base}/hello`, { userAgent: "KiokuBot/1.0" }, { guard: open });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.status).toBe(200);
    expect(result.page.body).toBe("<p>Hello KiokuBot/1.0</p>");
    expect(result.page.headers["x-robots-tag"]).toBe("noindex");
    expect(result.page.contentType).toBe("text/html");
  });

  it("decompresses gzip bodies", async () => {
    const result = await safeFetch(`${base}/gzip`, { userAgent: "KiokuBot/1.0" }, { guard: open });
    expect(result.ok && result.page.body).toBe("squeezed text");
  });

  it("follows redirects and records the final URL", async () => {
    const result = await safeFetch(`${base}/hop`, { userAgent: "KiokuBot/1.0" }, { guard: open });
    expect(result.ok && result.page.url).toBe(`${base}/hello`);
    expect(result.ok && result.page.redirects).toEqual([`${base}/hop`]);
  });

  it("stops redirect loops", async () => {
    const result = await safeFetch(`${base}/loop`, { userAgent: "KiokuBot/1.0", maxRedirects: 3 }, { guard: open });
    expect(result).toMatchObject({ ok: false, reason: "redirects" });
  });

  it("re-checks every redirect hop", async () => {
    const localOnly = { address: (ip: string) => ip === "127.0.0.1" || isPublicAddress(ip), port: () => true };
    const result = await safeFetch(`${base}/escape`, { userAgent: "KiokuBot/1.0" }, { guard: localOnly });
    expect(result).toMatchObject({ ok: false, reason: "address" });
  });

  it("caps the body size", async () => {
    const result = await safeFetch(`${base}/big`, { userAgent: "KiokuBot/1.0", maxBytes: 1_000 }, { guard: open });
    expect(result.ok && result.page.body.length).toBe(1_000);
    expect(result.ok && result.page.truncated).toBe(true);
  });

  it("gives up after the timeout", async () => {
    const result = await safeFetch(`${base}/slow`, { userAgent: "KiokuBot/1.0", timeoutMs: 200 }, { guard: open });
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("returns error statuses as pages, not failures", async () => {
    const result = await safeFetch(`${base}/missing`, { userAgent: "KiokuBot/1.0" }, { guard: open });
    expect(result.ok && result.page.status).toBe(404);
  });
});
