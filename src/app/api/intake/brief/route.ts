import { identifyBrand, lookUpBrand, lookupSetting, reviseBrief } from "@/lib/intake/identify";
import { validateBriefRequest } from "@/lib/intake/request";
import { budgetStatus, utcDay } from "@/lib/sov/budget";
import { refusalResponse } from "@/lib/sov/checks";
import { rateLimit } from "@/lib/sov/rate-limit";
import { checkStore, storeProblem, type CheckStore } from "@/lib/store";

const MAX_BODY = 16_000;
/** Web lookups stop once the day's budget is nearly spent, so they never take the last of it. */
const LOOKUP_RESERVE_USD = 0.05;

export const maxDuration = 30;

/** A lookup costs money, so it needs somewhere to book that, and room left in today's budget. */
async function canLookUp(store: CheckStore): Promise<boolean> {
  if (!lookupSetting(process.env) || storeProblem(process.env)) return false;
  try {
    const status = await budgetStatus(process.env, store);
    return !status || status.remainingUsd >= LOOKUP_RESERVE_USD;
  } catch (error) {
    console.error("Budget check before a lookup failed", error);
    return false;
  }
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Reply too long." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = validateBriefRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const store = checkStore();
  const limited = await rateLimit(process.env, store, input.mode === "lookup" ? "lookup" : "intake", request.headers);
  if (limited) return refusalResponse({ ok: false, status: 429, body: { error: limited.message, code: "rate-limit" }, retryAfterSeconds: limited.retryAfterSeconds });

  const headers = { "cache-control": "no-store" };
  const env = { env: process.env };
  if (input.mode === "revise") {
    const call = await reviseBrief(input, env);
    return Response.json(call.ok ? { source: "ai", output: call.output } : { source: "rules", reason: call.reason }, { headers });
  }
  if (input.mode === "identify") {
    const [call, lookup] = await Promise.all([identifyBrand(input, env), canLookUp(store)]);
    return Response.json(call.ok ? { source: "ai", output: call.output, lookup } : { source: "rules", reason: call.reason }, { headers });
  }

  if (!(await canLookUp(store))) return Response.json({ source: "rules", reason: "no-model" }, { headers });
  const call = await lookUpBrand(input, env);
  if (call.costUsd) {
    await store.charge(utcDay(new Date()), call.costUsd, Date.now()).catch((error: unknown) => console.error("Booking a lookup's cost failed", error));
  }
  return Response.json(call.ok ? { source: "ai", output: call.output, read: call.read } : { source: "rules", reason: call.reason }, { headers });
}
