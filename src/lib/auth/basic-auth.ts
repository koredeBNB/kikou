import { createHash, timingSafeEqual } from "node:crypto";
import { BRAND_NAME } from "@/lib/brand";
import type { Env } from "@/lib/providers/config";

export interface BasicAuthCredentials {
  user: string;
  password: string;
}

const REALM = `Basic realm="${BRAND_NAME}", charset="UTF-8"`;

export function basicAuthCredentials(env: Env): BasicAuthCredentials | null {
  const user = env.SOV_BASIC_AUTH_USER?.trim();
  const password = env.SOV_BASIC_AUTH_PASSWORD?.trim();
  return user && password ? { user, password } : null;
}

function decode(authorization: string | null): { user: string; password: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** Hashing first gives equal-length buffers, so the comparison time doesn't depend on where they differ. */
function same(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Returns a 401 challenge, or null when the request may continue (or basic auth is off). */
export function checkBasicAuth(authorization: string | null, env: Env): Response | null {
  const expected = basicAuthCredentials(env);
  if (!expected) return null;
  const given = decode(authorization);
  const userOk = same(given?.user ?? "", expected.user);
  const passwordOk = same(given?.password ?? "", expected.password);
  if (given && userOk && passwordOk) return null;
  return new Response("Password required.", {
    status: 401,
    headers: { "www-authenticate": REALM, "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
