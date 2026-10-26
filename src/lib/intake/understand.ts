import { callIntakeModel, intakeRulesForced, resolveIntakeModel, type IntakeClient } from "@/lib/intake/model";
import { buildIntakePrompt, type IntakeInput } from "@/lib/intake/prompt";
import { rulesTurn } from "@/lib/intake/rules";
import { parseIntakeTurn } from "@/lib/intake/schema";
import type { FallbackReason, IntakeResult } from "@/lib/intake/types";
import type { Env } from "@/lib/providers/config";

export const INTAKE_TIMEOUT_MS = 6000;
/** Below the browser's own wait (CLIENT_TIMEOUT_MS), so the server can still answer with the rules. */
const MAX_TIMEOUT_MS = 8000;

/** `SOV_INTAKE_TIMEOUT_MS` overrides the default. */
export function intakeTimeout(env: Env): number {
  const ms = Number(env.SOV_INTAKE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_TIMEOUT_MS) : INTAKE_TIMEOUT_MS;
}

interface UnderstandOptions {
  env: Env;
  client?: IntakeClient;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

class Timeout extends Error {}

/**
 * Reads one intake reply with the configured model, falling back to the rule-based parser when
 * there is no model, it is too slow, it fails, or its output doesn't validate.
 */
export async function understandReply(input: IntakeInput, options: UnderstandOptions): Promise<IntakeResult> {
  const rules = (reason: FallbackReason): IntakeResult => ({ turn: rulesTurn(input.field, input.reply), source: "rules", reason });
  if (intakeRulesForced(options.env)) return rules("forced");
  const setting = resolveIntakeModel(options.env);
  if (!setting) return rules("no-model");

  const client = options.client ?? callIntakeModel;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Timeout());
    }, options.timeoutMs ?? intakeTimeout(options.env));
  });

  try {
    const raw = await Promise.race([
      client(setting, buildIntakePrompt(input), { signal: abort.signal, fetchImpl: options.fetchImpl }),
      timeout,
    ]);
    const turn = parseIntakeTurn(raw, input.reply);
    return turn ? { turn, source: "ai" } : rules("invalid");
  } catch (error) {
    return rules(error instanceof Timeout ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}
