import { claimCheck } from "@/lib/sov/limit";
import { runCheck } from "@/lib/sov/run";
import { validateCheckRequest } from "@/lib/sov/validate";

export async function POST(request: Request) {
  const parsed = validateCheckRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const claim = claimCheck(process.env);
  if (!claim.ok) {
    return Response.json(
      { error: claim.message, code: "daily-limit" },
      { status: 429, headers: { "retry-after": String(claim.retryAfterSeconds) } },
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runCheck({ ...parsed.value, env: process.env, signal: abort.signal }, (event) => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
