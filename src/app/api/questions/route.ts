import { resolveIntakeModel } from "@/lib/intake/model";
import { refusalResponse } from "@/lib/sov/checks";
import { planQuestions } from "@/lib/sov/generate";
import { rateLimit } from "@/lib/sov/rate-limit";
import { validateQuestionRequest } from "@/lib/sov/validate";
import { modelQuestionWriter, questionsTimeout } from "@/lib/sov/writer";
import { checkStore } from "@/lib/store";

const MAX_BODY = 16_000;

/** Writer calls run side by side, with one top-up after them; the browser gives up at 90 seconds anyway. */
export const maxDuration = 90;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Request too long." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = validateQuestionRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const limited = await rateLimit(process.env, checkStore(), "questions", request.headers);
  if (limited) return refusalResponse({ ok: false, status: 429, body: { error: limited.message, code: "rate-limit" }, retryAfterSeconds: limited.retryAfterSeconds });

  const setting = resolveIntakeModel(process.env);
  const write = setting ? modelQuestionWriter(setting, { timeoutMs: questionsTimeout(process.env), signal: request.signal }) : undefined;
  const plan = await planQuestions(parsed.value.brief, parsed.value.count, { write });
  return Response.json(plan, { headers: { "cache-control": "no-store" } });
}
