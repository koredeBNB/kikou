import {
  buildIdentifyPrompt,
  buildRevisePrompt,
  IDENTIFY_JSON_SCHEMA,
  parseIdentified,
  parseRevision,
  REVISE_JSON_SCHEMA,
  type IdentifyInput,
  type ReviseInput,
} from "@/lib/intake/brief";
import { callStructuredModel, intakeRulesForced, resolveIntakeModel, type IntakeModelSetting, type StructuredSpec } from "@/lib/intake/model";
import { decode } from "@/lib/intake/schema";
import { intakeTimeout } from "@/lib/intake/understand";
import { truthy, type Env } from "@/lib/providers/config";

export type BriefFailure = "no-model" | "forced" | "timeout" | "error" | "invalid";

/** The model's decoded output, checked on the server and read again in the browser. */
export type BriefCall = { ok: true; output: unknown; costUsd: number } | { ok: false; reason: BriefFailure; costUsd?: number };

export const LOOKUP_TIMEOUT_MS = 15_000;
const LOOKUP_RESULTS = 3;

const IDENTIFY_SPEC: StructuredSpec = { name: "brand_brief", schema: IDENTIFY_JSON_SCHEMA, maxTokens: 600, temperature: 0 };
const LOOKUP_SPEC: StructuredSpec = { ...IDENTIFY_SPEC, webResults: LOOKUP_RESULTS };
const REVISE_SPEC: StructuredSpec = { name: "brief_revision", schema: REVISE_JSON_SCHEMA, maxTokens: 700, temperature: 0 };

/** Web lookups go through OpenRouter's web plugin; `SOV_INTAKE_WEB_LOOKUP=false` turns them off. */
export function lookupSetting(env: Env): IntakeModelSetting | null {
  const raw = env.SOV_INTAKE_WEB_LOOKUP?.trim();
  if (raw && !truthy(raw)) return null;
  const setting = resolveIntakeModel(env);
  return setting?.provider === "openrouter" ? setting : null;
}

interface CallOptions {
  env: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

class Timeout extends Error {}

async function run(
  setting: IntakeModelSetting | null,
  prompt: { system: string; user: string },
  spec: StructuredSpec,
  valid: (output: unknown) => boolean,
  { env, fetchImpl, timeoutMs }: CallOptions,
): Promise<BriefCall> {
  if (intakeRulesForced(env)) return { ok: false, reason: "forced" };
  if (!setting) return { ok: false, reason: "no-model" };
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Timeout());
    }, timeoutMs ?? intakeTimeout(env));
  });
  let costUsd = 0;
  try {
    const raw = await Promise.race([callStructuredModel(setting, prompt, spec, { signal: abort.signal, fetchImpl, onCost: (usd) => (costUsd = usd) }), timeout]);
    const output = decode(raw);
    return valid(output) ? { ok: true, output, costUsd } : { ok: false, reason: "invalid", costUsd };
  } catch (error) {
    return { ok: false, reason: error instanceof Timeout ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Drafts a brief for the brand the user named, from the model's own knowledge. */
export function identifyBrand(input: IdentifyInput, options: CallOptions): Promise<BriefCall> {
  return run(resolveIntakeModel(options.env), buildIdentifyPrompt(input), IDENTIFY_SPEC, (o) => parseIdentified(o, input) !== null, options);
}

/** Looks a brand the model didn't know up on the web, then drafts its brief. */
export function lookUpBrand(input: IdentifyInput, options: CallOptions): Promise<BriefCall> {
  return run(lookupSetting(options.env), buildIdentifyPrompt(input, true), LOOKUP_SPEC, (o) => parseIdentified(o, input, true) !== null, {
    ...options,
    timeoutMs: options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
  });
}

/** Reads what the user wants changed in the brief. */
export function reviseBrief(input: ReviseInput, options: CallOptions): Promise<BriefCall> {
  return run(resolveIntakeModel(options.env), buildRevisePrompt(input), REVISE_SPEC, (o) => parseRevision(o, input) !== null, options);
}
