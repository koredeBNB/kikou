import { answerBatch, prepareBatch, refusalResponse, storeDownResponse } from "@/lib/sov/checks";
import { checkStore } from "@/lib/store";

/** Next.js reads this statically. A batch stops answering at BATCH_BUDGET_MS (100 s), which leaves room to save and close. */
export const maxDuration = 120;

/** Answers up to five questions of a running check, streaming each one back as a line of JSON. */
export async function POST(request: Request, ctx: RouteContext<"/api/check/[id]/batch">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const deps = { env: process.env, store: checkStore() };
  let prepared;
  try {
    prepared = await prepareBatch(id, body, deps);
  } catch (error) {
    return storeDownResponse(error);
  }
  if (!prepared.ok) return refusalResponse(prepared);

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Answers keep being saved after the browser goes away, so asking again replays them for free.
      try {
        await answerBatch(prepared, deps, (event) => {
          if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        });
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
