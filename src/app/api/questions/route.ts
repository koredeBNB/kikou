import { resolveIntakeModel } from "@/lib/intake/model";
import { planQuestions } from "@/lib/sov/generate";
import { validateQuestionRequest } from "@/lib/sov/validate";
import { modelQuestionWriter, questionsTimeout } from "@/lib/sov/writer";

const MAX_BODY = 16_000;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Request too long." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = validateQuestionRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const setting = resolveIntakeModel(process.env);
  const write = setting ? modelQuestionWriter(setting, { timeoutMs: questionsTimeout(process.env), signal: request.signal }) : undefined;
  const plan = await planQuestions(parsed.value.brief, parsed.value.count, { write });
  return Response.json(plan, { headers: { "cache-control": "no-store" } });
}
