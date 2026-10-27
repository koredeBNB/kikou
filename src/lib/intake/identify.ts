import {
  buildIdentifyPrompt,
  buildLookupPrompt,
  buildRevisePrompt,
  IDENTIFY_JSON_SCHEMA,
  parseIdentified,
  parseLookup,
  parseRevision,
  REVISE_JSON_SCHEMA,
  type IdentifyInput,
  type LookupInput,
  type ReviseInput,
} from "@/lib/intake/brief";
import { callStructuredModel, intakeRulesForced, resolveIntakeModel, type IntakeModelSetting, type ModelPrompt, type StructuredSpec } from "@/lib/intake/model";
import { decode } from "@/lib/intake/schema";
import { readBrandSites, type SiteSnapshot } from "@/lib/intake/site";
import { intakeTimeout } from "@/lib/intake/understand";
import { truthy, type Env } from "@/lib/providers/config";
import { BRAND_REVIEW_JSON_SCHEMA, buildBrandReviewPrompt, parseBrandReview, type BrandReviewInput } from "@/lib/sov/brand-review";

export type BriefFailure = "no-model" | "forced" | "timeout" | "error" | "invalid";

/** The model's decoded output, checked on the server and read again in the browser. */
export type BriefCall = { ok: true; output: unknown; costUsd: number } | { ok: false; reason: BriefFailure; costUsd?: number };

/** For the model and its web search, after the brand's sites have been read (up to about 6.5 s). */
export const LOOKUP_TIMEOUT_MS = 18_000;
const LOOKUP_RESULTS = 8;

const IDENTIFY_SPEC: StructuredSpec = { name: "brand_brief", schema: IDENTIFY_JSON_SCHEMA, maxTokens: 600, temperature: 0 };
const LOOKUP_SPEC: StructuredSpec = { ...IDENTIFY_SPEC, maxTokens: 700, webResults: LOOKUP_RESULTS };
const REVISE_SPEC: StructuredSpec = { name: "brief_revision", schema: REVISE_JSON_SCHEMA, maxTokens: 700, temperature: 0 };
const BRAND_REVIEW_SPEC: StructuredSpec = { name: "brand_review", schema: BRAND_REVIEW_JSON_SCHEMA, maxTokens: 600, temperature: 0 };

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
  prompt: ModelPrompt,
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

/**
 * Researches a brand the model didn't know: reads the brand's own homepages, searches the web, then drafts
 * its brief with the rivals it really has. `read` lists the sites whose homepage was read.
 */
export async function lookUpBrand(
  input: LookupInput,
  options: CallOptions & { readSites?: (sites: string[]) => Promise<SiteSnapshot[]> },
): Promise<BriefCall & { read: string[] }> {
  const setting = lookupSetting(options.env);
  const usable = setting && !intakeRulesForced(options.env);
  const homepages = usable && input.sites?.length ? await (options.readSites ?? readBrandSites)(input.sites) : [];
  const read = homepages.map((h) => h.site);
  const call = await run(setting, buildLookupPrompt(input, homepages), LOOKUP_SPEC, (o) => parseLookup(o, input, read) !== null, {
    ...options,
    timeoutMs: options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
  });
  return { ...call, read };
}

/** Reads what the user wants changed in the brief. */
export function reviseBrief(input: ReviseInput, options: CallOptions): Promise<BriefCall> {
  return run(resolveIntakeModel(options.env), buildRevisePrompt(input), REVISE_SPEC, (o) => parseRevision(o, input) !== null, options);
}

/** Checks the brands a check's answers turned up: which aren't rivals in the category, and which are product lines. */
export function reviewBrands(input: BrandReviewInput, options: CallOptions): Promise<BriefCall> {
  return run(resolveIntakeModel(options.env), buildBrandReviewPrompt(input), BRAND_REVIEW_SPEC, (o) => parseBrandReview(o, input) !== null, options);
}
