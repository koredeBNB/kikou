import { validateIntakeRequest } from "@/lib/intake/request";
import { understandReply } from "@/lib/intake/understand";

const MAX_BODY = 16_000;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Reply too long." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = validateIntakeRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const result = await understandReply(parsed.value, { env: process.env });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
