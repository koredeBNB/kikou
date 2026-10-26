"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { Pip } from "@/components/art/pip";
import { FailedAnswers } from "@/components/check/failed-answers";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunState } from "@/hooks/use-check-run";
import { listJoin } from "@/lib/format";
import { MODEL_LABELS, type Brief, type ModelAnswer, type ModelId, type Question, type Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

/** Beyond this many questions, the card shows progress per assistant instead of every question. */
const COMPACT_AFTER = 12;

const LINES = [
  (m: string) => `Asking ${m} what it would recommend…`,
  (_: string, p: string) => `Listening for ${p} in every answer…`,
  () => "Collecting the sources each assistant cites…",
  () => "Jotting notes in the margins…",
  () => "Tallying who gets recommended first…",
];

export function RunCard({
  brief,
  questions,
  models,
  run,
  live,
  onOpenAnswer,
}: {
  brief: Brief;
  questions: Question[];
  models: ModelId[];
  run: RunState;
  live: Report;
  onOpenAnswer: (answer: ModelAnswer) => void;
}) {
  const [tick, setTick] = useState(0);
  const running = run.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 2400);
    return () => clearInterval(id);
  }, [running]);

  const answered = run.answers.length + run.errors.length;
  const total = run.total || questions.length * models.length;
  const latest = live.answers.at(-1);
  const latestCell = latest ? live.prompts.find((p) => p.question.id === latest.questionId)?.cells[latest.model] : undefined;
  const latestQuestion = latest ? questions.find((q) => q.id === latest.questionId) : undefined;
  const topRival = live.brands.find((b) => !b.isProduct && b.mentions > 0);
  const line = LINES[tick % LINES.length](MODEL_LABELS[models[tick % models.length]], brief.product);
  const compact = questions.length > COMPACT_AFTER;
  const left = running ? timeLeft(run, answered, total) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Pip mood={running ? "thinking" : "happy"} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-heading text-lg font-semibold">
              {running ? "Asking the assistants" : run.status === "failed" ? "The check stopped early" : "All answers are in"}
            </p>
            <p className="shrink-0 text-sm font-bold text-ink-soft tabular-nums">
              {answered} / {total} answers
            </p>
          </div>
          <Progress value={(answered / Math.max(total, 1)) * 100} className="mt-1.5 h-3.5" />
          <div className="mt-1.5 flex h-5 items-baseline gap-3 overflow-hidden text-sm">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={running ? line : "done"}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className={cn("min-w-0 flex-1 truncate", running ? "shimmer-text font-semibold" : "text-ink-soft")}
              >
                {running ? line : `Finished in ${finishedIn(run.elapsedMs)}.`}
              </motion.p>
            </AnimatePresence>
            {left && <span className="shrink-0 text-xs font-semibold text-ink-soft">{left}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-meadow-100 px-3 py-1 font-semibold text-meadow-700">
          {brief.product} mentioned in {live.product.mentions}/{live.answers.length}
        </span>
        {topRival && (
          <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-700">Most mentioned rival: {topRival.brand}</span>
        )}
        <span className="rounded-full bg-lavender-100 px-3 py-1 font-semibold text-lavender-500">{live.totalCitations} sources spotted</span>
      </div>

      <AnimatePresence initial={false}>
        {latest && latestQuestion && running && (
          <motion.div
            key={`${latest.model}-${latest.questionId}`}
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <button
              type="button"
              onClick={() => onOpenAnswer(latest)}
              className="flex w-full items-center gap-2.5 rounded-2xl bg-white/80 px-3 py-2 text-left text-sm shadow-[0_4px_14px_-10px_rgb(73_88_120/0.6)] transition hover:bg-white"
            >
              <ModelBadge model={latest.model} className="size-7" />
              <span className="min-w-0 flex-1 truncate">
                <strong>{MODEL_LABELS[latest.model]}</strong> just answered{" "}
                {latestCell?.mentioned ? (
                  <span className="font-semibold text-meadow-700">and put {brief.product} at #{latestCell.rank}</span>
                ) : (
                  <span className="text-ink-soft">
                    with {listJoin((latestCell?.brands ?? []).slice(0, 3)) || "no clear picks"}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs font-bold text-sky-700">Read</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <FailedAnswers errors={run.errors} questions={questions} />

      {compact ? (
        <ModelProgress models={models} questions={questions.length} run={run} live={live} />
      ) : (
      <ol className="space-y-2">
        {questions.map((question, index) => {
          const row = live.prompts.find((p) => p.question.id === question.id);
          return (
            <li key={question.id} className="rounded-2xl bg-cream-deep/45 p-3 sm:flex sm:items-center sm:gap-3">
              <p className="mb-2 min-w-0 flex-1 text-sm leading-snug sm:mb-0">
                <span className="mr-1.5 font-heading font-semibold text-sky-700">{index + 1}.</span>
                {question.text}
              </p>
              <div
                className="grid shrink-0 gap-1.5"
                style={{ gridTemplateColumns: `repeat(${models.length}, minmax(0, 1fr))` }}
              >
                {models.map((model) => {
                  const answer = run.answers.find((a) => a.questionId === question.id && a.model === model);
                  const error = run.errors.find((e) => e.questionId === question.id && e.model === model);
                  const cell = row?.cells[model];
                  return (
                    <AnswerPill
                      key={model}
                      model={model}
                      answer={answer}
                      error={error?.message}
                      rank={cell?.rank ?? null}
                      waiting={running}
                      onOpen={onOpenAnswer}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
}

function finishedIn(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)}s`;
}

/** From the pace so far; shown once a few answers are in. */
function timeLeft(run: RunState, answered: number, total: number): string | null {
  if (!run.startedAt || answered < 4 || answered >= total) return null;
  const perAnswer = (Date.now() - run.startedAt) / answered;
  const seconds = (perAnswer * (total - answered)) / 1000;
  if (seconds < 45) return "almost done";
  if (seconds < 90) return "about a minute left";
  return `about ${Math.round(seconds / 60)} minutes left`;
}

function ModelProgress({ models, questions, run, live }: { models: ModelId[]; questions: number; run: RunState; live: Report }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {models.map((model) => {
        const done = run.answers.filter((a) => a.model === model).length;
        const failed = run.errors.filter((e) => e.model === model).length;
        const stats = live.product.byModel[model];
        return (
          <li key={model} className="flex items-center gap-2.5 rounded-2xl bg-cream-deep/45 px-3 py-2">
            <ModelBadge model={model} className="size-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{MODEL_LABELS[model]}</span>
                <span className="text-xs font-bold text-ink-soft tabular-nums">
                  {done + failed}/{questions}
                </span>
              </div>
              <Progress value={((done + failed) / Math.max(questions, 1)) * 100} className="mt-1 h-2" />
              <p className="mt-1 text-xs text-ink-soft">
                {stats && stats.answers > 0 ? `Mentioned you in ${stats.mentions} of ${stats.answers}` : "Waiting for answers…"}
                {failed > 0 && <span className="text-blush-500"> · {failed} failed</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AnswerPill({
  model,
  answer,
  error,
  rank,
  waiting,
  onOpen,
}: {
  model: ModelId;
  answer?: ModelAnswer;
  error?: string;
  rank: number | null;
  waiting: boolean;
  onOpen: (answer: ModelAnswer) => void;
}) {
  const base = "flex h-9 min-w-[4.25rem] items-center justify-center gap-1 rounded-full pl-0.5 pr-2.5 text-sm font-bold";
  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(base, "animate-pop bg-blush-100 text-blush-500")}>
            <ModelBadge model={model} className="size-7 opacity-70" />!
          </span>
        </TooltipTrigger>
        <TooltipContent>{error}</TooltipContent>
      </Tooltip>
    );
  }
  if (!answer) {
    return (
      <span className={cn(base, "bg-white/70")} aria-label={`${MODEL_LABELS[model]} is thinking`}>
        <ModelBadge model={model} className="size-7 opacity-50" />
        {waiting ? (
          <span className="flex gap-0.5">
            {[0, 0.12, 0.24].map((d) => (
              <span key={d} className="size-1.5 animate-hop rounded-full bg-sky-300" style={{ animationDelay: `${d}s` }} />
            ))}
          </span>
        ) : (
          <span className="text-ink-soft">·</span>
        )}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(answer)}
          className={cn(
            base,
            "animate-pop transition hover:-translate-y-0.5 active:scale-95",
            rank ? "bg-meadow-200 text-meadow-700 shadow-[0_4px_10px_-6px_rgb(59_127_63/0.9)]" : "bg-white text-ink-soft/80",
          )}
        >
          <ModelBadge model={model} className="size-7" />
          {rank ? `#${rank}` : "—"}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {MODEL_LABELS[model]}: {rank ? `mentioned you at #${rank}` : "didn't mention you"} · tap to read
      </TooltipContent>
    </Tooltip>
  );
}
