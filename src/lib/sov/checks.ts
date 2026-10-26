import { providerStatus, type Env } from "@/lib/providers/config";
import { holdBudget, utcDay, type BudgetClaim } from "@/lib/sov/budget";
import { estimateFor } from "@/lib/sov/estimate";
import { MAX_BATCH, type BatchEvent, type CheckFinished, type CheckStarted } from "@/lib/sov/events";
import { rateLimit } from "@/lib/sov/rate-limit";
import { answerTask, MIN_ATTEMPT_MS } from "@/lib/sov/run";
import type { ModelId, Question } from "@/lib/sov/types";
import { validateCheckRequest } from "@/lib/sov/validate";
import { storeProblem } from "@/lib/store";
import { taskKey, type CheckStore, type RunRecord, type TaskResult } from "@/lib/store/types";

/** How long one batch request spends answering. Well inside the route's maxDuration. */
export const BATCH_BUDGET_MS = 100_000;
/** Keeps a quiet response moving while a slow answer is on its way. */
export const HEARTBEAT_MS = 15_000;
const BUSY_POLL_MS = 1000;

export interface Refusal {
  ok: false;
  status: number;
  body: { error: string; code?: string; limitUsd?: number; remainingUsd?: number };
  retryAfterSeconds?: number;
}

export interface Deps {
  env: Env;
  store: CheckStore;
  now?: () => number;
}

type RefusalExtra = Omit<Refusal["body"], "error"> & { retryAfterSeconds?: number };

const refuse = (status: number, error: string, { retryAfterSeconds, ...body }: RefusalExtra = {}): Refusal => ({
  ok: false,
  status,
  body: { error, ...body },
  retryAfterSeconds,
});

const overBudget = (claim: Extract<BudgetClaim, { ok: false }>) =>
  refuse(429, claim.message, { code: "daily-budget", limitUsd: claim.limitUsd, remainingUsd: claim.remainingUsd, retryAfterSeconds: claim.retryAfterSeconds });

export function refusalResponse({ status, body, retryAfterSeconds }: Refusal): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);
  return Response.json(body, { status, headers });
}

/** For when Redis can't be reached: the request fails cleanly instead of half-running. */
export function storeDownResponse(error: unknown): Response {
  console.error("Check store unavailable", error);
  return Response.json({ error: "Kioku couldn't reach its storage just now. Try again in a moment." }, { status: 503, headers: { "cache-control": "no-store" } });
}

const newRunId = () => crypto.randomUUID().replace(/-/g, "");

/** Checks the request, the visitor's rate limit and today's budget, then saves the run and holds its estimate. */
export async function startCheck(
  input: unknown,
  headers: Headers,
  { env, store, now = Date.now, id = newRunId() }: Deps & { id?: string },
): Promise<{ ok: true; started: CheckStarted } | Refusal> {
  const problem = storeProblem(env);
  if (problem) return refuse(503, problem);
  const parsed = validateCheckRequest(input);
  if (!parsed.ok) return refuse(400, parsed.error);

  const limited = await rateLimit(env, store, "check", headers, now());
  if (limited) return refuse(429, limited.message, { code: "rate-limit", retryAfterSeconds: limited.retryAfterSeconds });

  const { brief, questions, models, webSearch } = parsed.value;
  const providers = providerStatus(env);
  const estimate = estimateFor({ questions: questions.length, models, providers, webSearch });
  const total = questions.length * models.length;
  const started = new Date(now());
  const claim = await holdBudget(env, store, { runId: id, estimateUsd: estimate.costUsd, totalTasks: total, now: started });
  if (!claim.ok) return overBudget(claim);

  const run: RunRecord = { id, day: utcDay(started), createdAt: started.getTime(), brief, questions, models, webSearch, estimateUsd: estimate.costUsd };
  await store.saveRun(run);
  return { ok: true, started: { runId: id, models: providers.filter((p) => models.includes(p.id)), total } };
}

export interface PreparedBatch {
  ok: true;
  run: RunRecord;
  tasks: { model: ModelId; question: Question }[];
}

/** Loads the run, keeps only answers that belong to it, and renews its budget hold (or takes a new one). */
export async function prepareBatch(runId: string, input: unknown, { env, store, now = Date.now }: Deps): Promise<PreparedBatch | Refusal> {
  const problem = storeProblem(env);
  if (problem) return refuse(503, problem);
  const run = await store.loadRun(runId);
  if (!run) return refuse(404, "This check has expired. Start it again to get fresh answers.", { code: "run-missing" });

  const raw = input && typeof input === "object" ? (input as Record<string, unknown>).tasks : undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) return refuse(400, `Ask for between 1 and ${MAX_BATCH} answers at a time.`);
  const byId = new Map(run.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const tasks: PreparedBatch["tasks"] = [];
  for (const item of raw) {
    const { model, questionId } = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const question = typeof questionId === "string" ? byId.get(questionId) : undefined;
    if (!question || !run.models.includes(model as ModelId)) return refuse(400, "That answer isn't part of this check.");
    const key = taskKey(model as ModelId, question.id);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ model: model as ModelId, question });
  }

  const claim = await holdBudget(env, store, {
    runId,
    estimateUsd: run.estimateUsd,
    totalTasks: run.questions.length * run.models.length,
    now: new Date(now()),
  });
  if (!claim.ok) return overBudget(claim);
  return { ok: true, run, tasks };
}

export interface BatchOptions extends Deps {
  fetchImpl?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  budgetMs?: number;
  heartbeatMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Answers a batch, emitting each result as it lands. Every answer is claimed first and saved once, so a
 * repeated request gets the saved answer back instead of paying for it twice.
 */
export async function answerBatch({ run, tasks }: PreparedBatch, options: BatchOptions, emit: (event: BatchEvent) => void): Promise<void> {
  const { env, store, now = Date.now, delay = sleep, fetchImpl, timeoutMs } = options;
  const deadline = now() + (options.budgetMs ?? BATCH_BUDGET_MS);
  const heartbeat = setInterval(() => emit({ type: "ping" }), options.heartbeatMs ?? HEARTBEAT_MS);

  const settle = async (model: ModelId, question: Question): Promise<TaskResult> => {
    const key = taskKey(model, question.id);
    for (let first = true; ; first = false) {
      if (!first && deadline - now() < MIN_ATTEMPT_MS) {
        return { type: "error", model, questionId: question.id, message: "This answer was still on its way when time ran out." };
      }
      const claim = await store.claim(run.id, key, now());
      if (claim.state === "done") return claim.result;
      if (claim.state === "claimed") {
        const { result, costUsd } = await answerTask(model, question, { brief: run.brief, env, webSearch: run.webSearch, fetchImpl, delay, deadline, timeoutMs, now });
        await store.complete({ runId: run.id, task: key, result, costUsd, day: utcDay(new Date(now())), now: now() });
        return result;
      }
      await delay(BUSY_POLL_MS);
    }
  };

  try {
    await Promise.all(
      tasks.map(async ({ model, question }) => {
        try {
          emit(await settle(model, question));
        } catch (error) {
          console.error("Batch answer failed", error);
          emit({ type: "error", model, questionId: question.id, message: "This answer couldn't be saved." });
        }
      }),
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/** Releases the run's budget holds. Safe to call more than once, or for a run that has expired. */
export async function finishCheck(runId: string, { store, now = Date.now }: Deps): Promise<CheckFinished> {
  const run = await store.loadRun(runId);
  const today = utcDay(new Date(now()));
  return store.release(runId, run ? [run.day, today] : [today]);
}
