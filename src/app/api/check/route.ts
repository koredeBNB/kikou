import { providerStatus } from "@/lib/providers/config";
import { reserveBudget, settleBudget } from "@/lib/sov/budget";
import { estimateCheck } from "@/lib/sov/estimate";
import { runCheck, type CostMeter } from "@/lib/sov/run";
import { validateCheckRequest } from "@/lib/sov/validate";

export async function POST(request: Request) {
  const parsed = validateCheckRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { questions, models, webSearch } = parsed.value;
  const statuses = providerStatus(process.env).filter((p) => models.includes(p.id));
  const estimate = estimateCheck({
    questions: questions.length,
    models: statuses.map((p) => ({ id: p.id, live: p.source === "live", webSearch: p.webSearch ?? false })),
    webSearch,
  });
  const claim = reserveBudget(process.env, estimate.costUsd);
  if (!claim.ok) {
    return Response.json(
      { error: claim.message, code: "daily-budget", remainingUsd: claim.remainingUsd, limitUsd: claim.limitUsd },
      { status: 429, headers: { "retry-after": String(claim.retryAfterSeconds) } },
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const meter: CostMeter = { costUsd: 0 };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runCheck({ ...parsed.value, env: process.env, signal: abort.signal, meter }, (event) => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        });
      } finally {
        settleBudget(claim, meter.costUsd);
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
