import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch, type MiddlewareSourceConfig } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as proxyModule from "@/proxy";

const authorization = `Basic ${Buffer.from("team:open-sesame").toString("base64")}`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("runs on every page, API route and asset", () => {
    const config = (proxyModule as { config?: MiddlewareSourceConfig }).config ?? {};
    for (const url of ["/", "/report/abc123", "/api/check", "/api/intake", "/api/providers", "/_next/static/chunk.js", "/favicon.ico"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });

  it("asks for the password on pages and API routes when basic auth is configured", () => {
    vi.stubEnv("SOV_BASIC_AUTH_USER", "team");
    vi.stubEnv("SOV_BASIC_AUTH_PASSWORD", "open-sesame");
    for (const [url, method] of [["http://localhost/", "GET"], ["http://localhost/api/check", "POST"]]) {
      const response = proxyModule.proxy(new NextRequest(url, { method }));
      expect(response.status, url).toBe(401);
    }
    const allowed = proxyModule.proxy(new NextRequest("http://localhost/api/check", { method: "POST", headers: { authorization } }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("www-authenticate")).toBeNull();
  });

  it("lets requests through when basic auth isn't configured", () => {
    vi.stubEnv("SOV_BASIC_AUTH_USER", "");
    vi.stubEnv("SOV_BASIC_AUTH_PASSWORD", "");
    expect(proxyModule.proxy(new NextRequest("http://localhost/")).status).toBe(200);
  });
});
