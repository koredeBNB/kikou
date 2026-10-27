import {
  MAX_EARLIER,
  parseIdentified,
  parseRevision,
  type BriefDraft,
  type BriefStage,
  type IdentifyInput,
  type Identified,
  type ReviseInput,
  type Revision,
} from "@/lib/intake/brief";
import type { IntakeInput } from "@/lib/intake/prompt";
import { rulesTurn } from "@/lib/intake/rules";
import { parseIntakeTurn } from "@/lib/intake/schema";
import { INTAKE_FIELDS, type FallbackReason, type IntakeField, type IntakeResult, type IntakeState } from "@/lib/intake/types";
import { MAX_QUESTION_COUNT, MAX_TOPICS } from "@/lib/sov/intake";

const MAX_REPLY = 1000;
const MAX_VALUE = 120;
const MAX_COMPETITORS = 8;
const MAX_TOPIC = 40;
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
  const count = raw.count;
  const state: IntakeState = {
    product: str(raw.product),
    category: str(raw.category),
    audience: str(raw.audience),
    competitors: Array.isArray(raw.competitors) ? raw.competitors.map((c) => str(c)).filter(Boolean).slice(0, MAX_COMPETITORS) : [],
    website: str(raw.website) || undefined,
    topics: Array.isArray(raw.topics) ? raw.topics.map((t) => str(t, MAX_TOPIC)).filter(Boolean).slice(0, MAX_TOPICS) : [],
    count: Number.isInteger(count) && (count as number) >= 1 && (count as number) <= MAX_QUESTION_COUNT ? (count as number) : undefined,
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
      const turn = parseIntakeTurn({ ...data.turn, message: data.turn.message ?? "" }, input.reply, input.field);
      return turn ? { turn, source: "ai" } : rules("invalid");
    }
    return rules(REASONS.includes(data.reason as FallbackReason) ? (data.reason as FallbackReason) : "invalid");
  } catch {
    return rules(abort.signal.aborted ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}

export type BriefRequest =
  | ({ mode: "identify" | "lookup" } & IdentifyInput)
  | ({ mode: "revise" } & ReviseInput);

const MODES = ["identify", "lookup", "revise"] as const;
const STAGES: BriefStage[] = ["confirm", "plan"];

function briefOf(value: unknown): BriefDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const product = str(raw.product);
  const category = str(raw.category);
  if (!product || !category) return null;
  const draft: BriefDraft = {
    product,
    category,
    audience: str(raw.audience),
    competitors: Array.isArray(raw.competitors) ? raw.competitors.map((c) => str(c)).filter(Boolean).slice(0, MAX_COMPETITORS) : [],
  };
  const description = str(raw.description);
  if (description) draft.description = description;
  const website = str(raw.website);
  if (website) draft.website = website;
  const topics = Array.isArray(raw.topics) ? raw.topics.map((t) => str(t, MAX_TOPIC)).filter(Boolean).slice(0, MAX_TOPICS) : [];
  if (topics.length) draft.topics = topics;
  return draft;
}

export function validateBriefRequest(input: unknown): { ok: true; value: BriefRequest } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Expected a JSON body." };
  const body = input as Record<string, unknown>;
  const mode = MODES.find((m) => m === body.mode);
  if (!mode) return { ok: false, error: "Unknown brief step." };
  const reply = str(body.reply, MAX_REPLY);
  if (!reply) return { ok: false, error: "Empty reply." };
  if (mode !== "revise") {
    const earlier = Array.isArray(body.earlier) ? body.earlier.map((e) => str(e, MAX_REPLY)).filter(Boolean).slice(-MAX_EARLIER) : [];
    return { ok: true, value: { mode, reply, earlier } };
  }
  const brief = briefOf(body.brief);
  if (!brief) return { ok: false, error: "Missing brief." };
  const stage = STAGES.find((s) => s === body.stage) ?? "confirm";
  return { ok: true, value: { mode, reply, brief, stage } };
}

/** Longer than the server's lookup timeout, so a slow search still gets the server's own answer. */
export const LOOKUP_CLIENT_TIMEOUT_MS = 18_000;

async function postBrief(
  body: BriefRequest,
  { fetchImpl = fetch, timeoutMs = CLIENT_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ output: unknown; lookup: boolean } | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/intake/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { source?: unknown; output?: unknown; lookup?: unknown };
    return data.source === "ai" ? { output: data.output, lookup: data.lookup === true } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type RequestOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

/**
 * Asks the server to identify the brand. `identified` is null when the model couldn't help, so the
 * intake carries on with the rules; `lookup` says whether a web lookup can be tried for an unknown brand.
 */
export async function requestIdentify(input: IdentifyInput, options: RequestOptions = {}): Promise<{ identified: Identified | null; lookup: boolean }> {
  const data = await postBrief({ mode: "identify", ...input }, options);
  return { identified: data ? parseIdentified(data.output, input) : null, lookup: data?.lookup ?? false };
}

export async function requestLookup(input: IdentifyInput, options: RequestOptions = {}): Promise<Identified | null> {
  const data = await postBrief({ mode: "lookup", ...input }, { timeoutMs: LOOKUP_CLIENT_TIMEOUT_MS, ...options });
  return data ? parseIdentified(data.output, input, true) : null;
}

export async function requestRevision(input: ReviseInput, options: RequestOptions = {}): Promise<Revision | null> {
  const data = await postBrief({ mode: "revise", ...input }, options);
  return data ? parseRevision(data.output, input) : null;
}
