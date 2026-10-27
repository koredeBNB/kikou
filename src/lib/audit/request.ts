import type { AuditInput } from "@/lib/audit/audit";
import { pageKey } from "@/lib/audit/pages";
import type { AuditEvent, SiteAudit } from "@/lib/audit/types";
import { coveredBy, domainOf, siteDomain } from "@/lib/sov/citations";
import { readNdjson } from "@/lib/sov/scheduler";
import type { Brief, Citation } from "@/lib/sov/types";

export const MAX_CITED = 20;
const MAX_VALUE = 120;
const CLIENT_TIMEOUT_MS = 80_000;
const NO_SITE = "Add your website to the brief so Pip knows which site to read.";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max = MAX_VALUE) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function validateAuditRequest(input: unknown): { ok: true; value: AuditInput } | { ok: false; error: string } {
  if (!isObject(input)) return { ok: false, error: "Expected a JSON body." };
  const site = siteDomain(str(input.site, 300));
  if (!site) return { ok: false, error: NO_SITE };
  const brand = str(input.brand);
  const category = str(input.category);
  if (!brand || !category) return { ok: false, error: "Send the brand and its category." };
  const audience = str(input.audience) || undefined;
  const cited: AuditInput["cited"] = [];
  for (const raw of Array.isArray(input.cited) ? input.cited : []) {
    if (!isObject(raw) || typeof raw.url !== "string" || raw.url.length > 2_000) continue;
    const domain = domainOf(raw.url);
    const count = Number(raw.count);
    if (!domain || !coveredBy(domain, [site]) || !Number.isInteger(count) || count < 1) continue;
    cited.push({ url: raw.url.trim(), count: Math.min(count, 10_000) });
    if (cited.length === MAX_CITED) break;
  }
  return { ok: true, value: { site, brand, category, audience, cited } };
}

/** What to audit for a report: the brief's main site, and how often the answers cited each of its pages. Null without a website. */
export function auditInputFor(brief: Brief, answers: { citationList: Citation[] }[]): AuditInput | null {
  const site = siteDomain(brief.website);
  if (!site) return null;
  const pages = new Map<string, { url: string; count: number }>();
  for (const answer of answers) {
    for (const citation of answer.citationList) {
      if (!coveredBy(citation.domain, [site])) continue;
      const key = pageKey(citation.url);
      const page = pages.get(key);
      if (page) page.count++;
      else pages.set(key, { url: citation.url, count: 1 });
    }
  }
  const cited = [...pages.values()].sort((a, b) => b.count - a.count).slice(0, MAX_CITED);
  return { site, brand: brief.product, category: brief.category, audience: brief.audience || undefined, cited };
}

export type AuditRequestResult = { ok: true; audit: SiteAudit } | { ok: false; message: string; code?: string };

/** Runs an audit on the server, passing its progress to `onProgress` as it streams in. */
export async function requestAudit(
  input: AuditInput,
  onProgress: (event: AuditEvent) => void,
  { fetchImpl = fetch, timeoutMs = CLIENT_TIMEOUT_MS, signal }: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AuditRequestResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const stop = () => abort.abort();
  signal?.addEventListener("abort", stop);
  try {
    const response = await fetchImpl("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
      const message = typeof body.error === "string" ? body.error : `The audit couldn't start (${response.status}).`;
      return typeof body.code === "string" ? { ok: false, message, code: body.code } : { ok: false, message };
    }
    let result = null as AuditRequestResult | null;
    await readNdjson(response.body, (value) => {
      const event = value as AuditEvent;
      if (event.type === "done") result = { ok: true, audit: event.audit };
      else if (event.type === "error") result = { ok: false, message: event.message };
      else onProgress(event);
    });
    return result ?? { ok: false, message: "The audit stopped before it finished. Try again." };
  } catch {
    if (abort.signal.aborted && !signal?.aborted) return { ok: false, message: "The audit took too long. Try again in a moment." };
    return { ok: false, message: "Kioku couldn't reach its server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
