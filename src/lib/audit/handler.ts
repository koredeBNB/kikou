import { runAudit, type Fetcher } from "@/lib/audit/audit";
import { validateAuditRequest } from "@/lib/audit/request";
import type { AuditEvent } from "@/lib/audit/types";
import type { Env } from "@/lib/providers/config";
import { refusalResponse } from "@/lib/sov/checks";
import { rateLimit, siteAuditLimit } from "@/lib/sov/rate-limit";
import type { CheckStore } from "@/lib/store/types";

const MAX_BODY = 16_000;

export interface AuditHandlerDeps {
  env: Env;
  store: CheckStore;
  fetch?: Fetcher;
}

/** Validates and rate-limits an audit request, then streams the audit back as lines of JSON. */
export async function handleAudit(request: Request, deps: AuditHandlerDeps): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "That request is too big." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = validateAuditRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const limited = await rateLimit(deps.env, deps.store, "audit", request.headers);
  if (limited) return refusalResponse({ ok: false, status: 429, body: { error: limited.message, code: "rate-limit" }, retryAfterSeconds: limited.retryAfterSeconds });
  const busy = await siteAuditLimit(deps.env, deps.store, input.site);
  if (busy) return refusalResponse({ ok: false, status: 429, body: { error: busy.message, code: "site-limit" }, retryAfterSeconds: busy.retryAfterSeconds });

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AuditEvent) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await runAudit(input, send, { fetch: deps.fetch });
        send(result.ok ? { type: "done", audit: result.audit } : { type: "error", message: result.message });
      } catch (error) {
        console.error("Site audit failed", error);
        send({ type: "error", message: `Pip tripped over something reading ${input.site}. Try again in a moment.` });
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}
