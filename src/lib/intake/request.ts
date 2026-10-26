import type { IntakeInput } from "@/lib/intake/prompt";
import { rulesTurn } from "@/lib/intake/rules";
import { parseIntakeTurn } from "@/lib/intake/schema";
import { INTAKE_FIELDS, type FallbackReason, type IntakeField, type IntakeResult, type IntakeState } from "@/lib/intake/types";

const MAX_REPLY = 1000;
const MAX_VALUE = 120;
const MAX_COMPETITORS = 8;
const REASONS: FallbackReason[] = ["no-model", "forced", "timeout", "error", "invalid"];
/** Longer than the server's longest model timeout, so the server can answer with its own fallback first. */
export const CLIENT_TIMEOUT_MS = 9000;

const str = (value: unknown, max = MAX_VALUE) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const isField = (value: unknown): value is IntakeField => INTAKE_FIELDS.includes(value as IntakeField);
const fields = (value: unknown): IntakeField[] => (Array.isArray(value) ? [...new Set(value.filter(isField))] : []);

export function validateIntakeRequest(input: unknown): { ok: true; value: IntakeInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a JSON body." };
  const body = input as Record<string, unknown>;
  if (!isField(body.field)) return { ok: false, error: "Unknown intake step." };
  const reply = str(body.reply, MAX_REPLY);
  if (!reply) return { ok: false, error: "Empty reply." };

  const raw = (body.state && typeof body.state === "object" ? body.state : {}) as Record<string, unknown>;
  const state: IntakeState = {
    product: str(raw.product),
    category: str(raw.category),
    audience: str(raw.audience),
    competitors: Array.isArray(raw.competitors) ? raw.competitors.map((c) => str(c)).filter(Boolean).slice(0, MAX_COMPETITORS) : [],
    website: str(raw.website) || undefined,
    skipped: fields(raw.skipped),
    nudged: fields(raw.nudged),
  };
  return { ok: true, value: { field: body.field, reply, state } };
}

/**
 * Asks the server to read an intake reply. Rule-based results are re-read locally, and any
 * failure or slow response falls back to the rules, so the intake never gets stuck.
 */
export async function requestIntake(
  input: IntakeInput,
  { fetchImpl = fetch, timeoutMs = CLIENT_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<IntakeResult> {
  const rules = (reason: FallbackReason): IntakeResult => ({ turn: rulesTurn(input.field, input.reply), source: "rules", reason });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: abort.signal,
    });
    if (!response.ok) return rules("error");
    const data = (await response.json()) as { source?: unknown; reason?: unknown; turn?: Record<string, unknown> };
    if (data.source === "ai" && data.turn) {
      const turn = parseIntakeTurn({ ...data.turn, message: data.turn.message ?? "" }, input.reply);
      return turn ? { turn, source: "ai" } : rules("invalid");
    }
    return rules(REASONS.includes(data.reason as FallbackReason) ? (data.reason as FallbackReason) : "invalid");
  } catch {
    return rules(abort.signal.aborted ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}
