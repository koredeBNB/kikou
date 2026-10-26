import { finishCheck, storeDownResponse } from "@/lib/sov/checks";
import { checkStore } from "@/lib/store";

export const maxDuration = 15;

/** Called when a check ends or is abandoned, so its unused budget hold goes back to the day's budget. */
export async function POST(_request: Request, ctx: RouteContext<"/api/check/[id]/finish">) {
  const { id } = await ctx.params;
  try {
    const finished = await finishCheck(id, { env: process.env, store: checkStore() });
    return Response.json(finished, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return storeDownResponse(error);
  }
}
