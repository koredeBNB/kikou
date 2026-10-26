import { refusalResponse, startCheck, storeDownResponse } from "@/lib/sov/checks";
import { checkStore } from "@/lib/store";

export const maxDuration = 30;

/** Starts a check. The answers come from `/api/check/[id]/batch`, a few at a time. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const result = await startCheck(body, request.headers, { env: process.env, store: checkStore() });
    if (!result.ok) return refusalResponse(result);
    return Response.json(result.started, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return storeDownResponse(error);
  }
}
