import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";

/**
 * Fetches pages on sites a visitor names without letting them point Kioku's server at private networks:
 * http(s) on ports 80 and 443 only, no IP addresses in private, loopback, link-local, metadata or reserved
 * ranges (checked when the socket connects, so a DNS answer can't change in between), every redirect re-checked,
 * and a cap on time and on the decompressed size.
 */

export type FetchFailureReason = "url" | "scheme" | "port" | "credentials" | "host" | "address" | "redirects" | "timeout" | "network";

export interface FetchedPage {
  /** The URL that answered, after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  /** The media type without parameters, e.g. "text/html". */
  contentType: string;
  body: string;
  /** The URLs that redirected, in order. */
  redirects: string[];
  truncated: boolean;
}

export type FetchResult = { ok: true; page: FetchedPage } | { ok: false; reason: FetchFailureReason; message: string; url: string };

export interface SafeFetchOptions {
  userAgent: string;
  /** For the whole fetch, redirects included. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;
export type Lookup = (hostname: string, options: { all: true }, callback: LookupCallback) => void;

export interface Guard {
  address?: (ip: string) => boolean;
  port?: (port: number) => boolean;
}

export interface SafeFetchDeps {
  guard?: Guard;
  lookup?: Lookup;
}

const MESSAGES: Record<FetchFailureReason, string> = {
  url: "That doesn't look like a web address.",
  scheme: "Only http and https sites can be checked.",
  port: "Only sites on the usual web ports (80 and 443) can be checked.",
  credentials: "Web addresses with a login in them can't be checked.",
  host: "That address points inside a private network, so Kioku won't fetch it.",
  address: "That address points inside a private network, so Kioku won't fetch it.",
  redirects: "The site redirected too many times.",
  timeout: "The site took too long to answer.",
  network: "Kioku couldn't connect to the site.",
};

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

function v6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase().split("%")[0];
  const dotted = address.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number);
    address = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? null : tail ? tail.split(":") : [];
  const groups = back === null ? front : [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back];
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16)) : null;
}

const v4From = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

/** IPv4 inside an IPv6 address: mapped, compatible, NAT64 and 6to4 forms. */
function embeddedV4(groups: number[]): string | null {
  const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
  if (zeros(0, 5) && groups[5] === 0xffff) return v4From(groups[6], groups[7]);
  if (zeros(0, 6)) return v4From(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return v4From(groups[6], groups[7]);
  if (groups[0] === 0x2002) return v4From(groups[1], groups[2]);
  return null;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !BLOCKED.check(ip, "ipv4");
  if (version !== 6) return false;
  const groups = v6Groups(ip);
  if (!groups) return false;
  const v4 = embeddedV4(groups);
  if (v4) return isPublicAddress(v4);
  return !BLOCKED.check(ip.split("%")[0], "ipv6");
}

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];
const defaultPort = (port: number) => port === 80 || port === 443;

export function checkUrl(input: string, guard: Guard = {}): { ok: true; url: URL } | { ok: false; reason: FetchFailureReason; message: string } {
  const fail = (reason: FetchFailureReason) => ({ ok: false as const, reason, message: MESSAGES[reason] });
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("scheme");
  if (url.username || url.password) return fail("credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) {
    if (!(guard.address ?? isPublicAddress)(host)) return fail("address");
  } else if (!host.includes(".") || host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return fail("host");
  }
  if (url.port && !(guard.port ?? defaultPort)(Number(url.port))) return fail("port");
  return { ok: true, url };
}

const BLOCKED_CODE = "EKIOKU_BLOCKED";
const TIMEOUT_CODE = "EKIOKU_TIMEOUT";
const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

const systemLookup: Lookup = (hostname, options, callback) => dnsLookup(hostname, { ...options, verbatim: true }, callback);

type NodeLookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Resolves like `dns.lookup`, but refuses the connection if any address it would use isn't public. */
function guardedLookup(base: Lookup, allowed: (ip: string) => boolean) {
  return (hostname: string, options: { all?: boolean } | number, callback: NodeLookupCallback) => {
    const all = typeof options === "object" && options.all === true;
    base(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, all ? [] : "");
      if (addresses.length === 0 || addresses.some((a) => !allowed(a.address))) {
        return callback(coded(`${hostname} resolves to a private address`, BLOCKED_CODE), all ? [] : "");
      }
      if (all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
}

function flatten(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) flat[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

function send(
  url: URL,
  { userAgent, accept, maxBytes, timeoutMs, lookup }: { userAgent: string; accept: string; maxBytes: number; timeoutMs: number; lookup: ReturnType<typeof guardedLookup> },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: lookup as unknown as http.RequestOptions["lookup"],
        headers: { "user-agent": userAgent, accept, "accept-encoding": "gzip, deflate, br", "accept-language": "en" },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = flatten(response.headers);
        if (status >= 300 && status < 400 && headers.location) {
          response.resume();
          settle(() => resolve({ status, headers, body: Buffer.alloc(0), truncated: false }));
          request.destroy();
          return;
        }
        const encoding = (headers["content-encoding"] ?? "").trim().toLowerCase();
        const decoder =
          encoding === "gzip" || encoding === "x-gzip"
            ? zlib.createGunzip()
            : encoding === "deflate"
              ? zlib.createInflate()
              : encoding === "br"
                ? zlib.createBrotliDecompress()
                : null;
        const stream: NodeJS.ReadableStream = decoder ? response.pipe(decoder) : response;
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = (truncated: boolean) =>
          settle(() => resolve({ status, headers, body: Buffer.concat(chunks).subarray(0, maxBytes), truncated }));
        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size > maxBytes) {
            finish(true);
            request.destroy();
          }
        });
        stream.on("end", () => finish(false));
        stream.on("error", (error) => {
          if (timedOut) settle(() => reject(coded("timeout", TIMEOUT_CODE)));
          else if (chunks.length > 0) finish(true);
          else settle(() => reject(error));
        });
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      request.destroy(coded("timeout", TIMEOUT_CODE));
    }, timeoutMs);
    request.on("error", (error) => settle(() => reject(timedOut ? coded("timeout", TIMEOUT_CODE) : error)));
    request.end();
  });
}

function decode(body: Buffer, contentType: string | undefined): string {
  const charset = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export async function safeFetch(input: string, options: SafeFetchOptions, deps: SafeFetchDeps = {}): Promise<FetchResult> {
  const guard: Required<Guard> = { address: deps.guard?.address ?? isPublicAddress, port: deps.guard?.port ?? defaultPort };
  const lookup = guardedLookup(deps.lookup ?? systemLookup, guard.address);
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  const accept = options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8";
  const fail = (reason: FetchFailureReason, url: string, message = MESSAGES[reason]): FetchResult => ({ ok: false, reason, message, url });
  const redirects: string[] = [];
  let current = input;

  for (let hop = 0; ; hop++) {
    const checked = checkUrl(current, guard);
    if (!checked.ok) return fail(checked.reason, current);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail("timeout", current);
    let raw: RawResponse;
    try {
      raw = await send(checked.url, { userAgent: options.userAgent, accept, maxBytes, timeoutMs: remaining, lookup });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === BLOCKED_CODE) return fail("address", current);
      if (code === TIMEOUT_CODE) return fail("timeout", current);
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return fail("network", current, "Kioku couldn't find that site. Check the address is right.");
      return fail("network", current);
    }
    if (raw.status >= 300 && raw.status < 400 && raw.headers.location) {
      if (hop >= maxRedirects) return fail("redirects", current);
      redirects.push(checked.url.toString());
      try {
        current = new URL(raw.headers.location, checked.url).toString();
      } catch {
        return fail("url", raw.headers.location);
      }
      continue;
    }
    const contentType = raw.headers["content-type"];
    return {
      ok: true,
      page: {
        url: checked.url.toString(),
        status: raw.status,
        headers: raw.headers,
        contentType: (contentType ?? "").split(";")[0].trim().toLowerCase(),
        body: decode(raw.body, contentType),
        redirects,
        truncated: raw.truncated,
      },
    };
  }
}
