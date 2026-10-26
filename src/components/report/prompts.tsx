"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, BubbleChatQuestionIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { FailedAnswers } from "@/components/check/failed-answers";
import { Icon } from "@/components/icon";
import { SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { INTENT_LABELS, listJoin } from "@/lib/format";
import { filterPrompts, pageOf, type PromptStatus } from "@/lib/sov/prompt-filter";
import type { RunError } from "@/lib/sov/storage";
import { MODEL_LABELS, type AnalyzedAnswer, type ModelId, type PromptRow, type Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

const STATUSES: { value: PromptStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "missing", label: "Where you're missing" },
  { value: "named", label: "Where you're named" },
];

function Cell({
  model,
  row,
  product,
  answer,
  failed,
  onOpen,
}: {
  model: ModelId;
  row: PromptRow;
  product: string;
  answer?: AnalyzedAnswer;
  failed?: string;
  onOpen: (a: AnalyzedAnswer) => void;
}) {
  const cell = row.cells[model];
  const base = "flex h-9 w-full min-w-[4.5rem] items-center justify-center gap-1 rounded-full pl-0.5 pr-2.5 text-sm font-bold";
  if (!answer || !cell) {
    return (
      <span className={cn(base, "bg-white/60 text-ink-soft")} aria-label={`${MODEL_LABELS[model]}: ${failed ? "failed" : "no answer"}`} title={failed}>
        <ModelBadge model={model} className="size-7 opacity-50" />
        {failed ? "Failed" : "n/a"}
      </span>
    );
  }
  const rivals = cell.brands.filter((b) => b !== product).slice(0, 3);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(answer)}
          className={cn(
            base,
            "transition hover:-translate-y-0.5 active:scale-95",
            cell.mentioned ? "bg-meadow-200 text-meadow-700 shadow-[0_4px_10px_-6px_rgb(59_127_63/0.9)]" : "bg-blush-100 text-[#a5463d]",
          )}
        >
          <ModelBadge model={model} className="size-7" />
          {cell.mentioned ? `#${cell.rank}` : "Miss"}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {MODEL_LABELS[model]}: {cell.mentioned ? `mentioned you at #${cell.rank}` : `recommended ${listJoin(rivals) || "no one in particular"}`} · click to read
      </TooltipContent>
    </Tooltip>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      variant="outline"
      spacing={1}
      aria-label={label}
      className={cn("flex-wrap", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-8 rounded-full px-3 text-xs font-bold">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function PromptsCard({
  report,
  errors = [],
  onOpenAnswer,
}: {
  report: Report;
  errors?: RunError[];
  onOpenAnswer: (answer: AnalyzedAnswer) => void;
}) {
  const [status, setStatus] = useState<PromptStatus>("all");
  const [topic, setTopic] = useState("all");
  const [page, setPage] = useState(0);
  const topics = [...new Set(report.questions.map((q) => q.topic).filter((t): t is string => Boolean(t)))];
  const missingCells = report.prompts.reduce((s, p) => s + Object.values(p.cells).filter((c) => c && !c.mentioned).length, 0);
  const rows = filterPrompts(report.prompts, { status, topic: topic === "all" ? null : topic });
  const shown = pageOf(rows, page);
  const answerFor = (questionId: string, model: ModelId) => report.answers.find((a) => a.questionId === questionId && a.model === model);
  const failedFor = (questionId: string, model: ModelId) => errors.find((e) => e.questionId === questionId && e.model === model)?.message;
  const missingEverywhere = new Set(report.missingPrompts);
  const position = new Map(report.questions.map((q, i) => [q.id, i + 1]));
  const pick = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };
  const turnTo = (next: number) => {
    setPage(next);
    const card = document.getElementById("prompts");
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const statusChips = (className?: string) => (
    <Chips label="Filter questions" value={status} options={STATUSES} onChange={pick((v) => setStatus(v as PromptStatus))} className={className} />
  );

  return (
    <SectionCard
      id="prompts"
      icon={BubbleChatQuestionIcon}
      tint="bg-lavender-100 text-[#5f4bb0]"
      title="Prompt by prompt"
      description={`Every question and every answer. You're missing from ${missingCells} of ${report.totalAnswers} answers${report.missingPrompts.length ? `, and no assistant mentions you for ${report.missingPrompts.length} question${report.missingPrompts.length === 1 ? "" : "s"}` : ""}.`}
      action={statusChips("hidden justify-end sm:flex")}
    >
      <div className="mb-4 space-y-3">
        {statusChips("sm:hidden")}
        {topics.length > 0 && (
          <Chips
            label="Filter by topic"
            value={topic}
            options={[{ value: "all", label: "Every topic" }, ...topics.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))]}
            onChange={pick(setTopic)}
          />
        )}
        <FailedAnswers errors={errors} questions={report.questions} />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-ink-soft">
          {status === "named"
            ? `No assistant named ${report.brief.product} for these questions yet.`
            : `Every assistant mentioned ${report.brief.product} for every question here. Lovely!`}
        </p>
      ) : (
        <>
          <ol className="space-y-2.5">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.items.map((row) => {
                const rivals = row.competitorsMentioned.slice(0, 3);
                return (
                  <motion.li
                    key={row.question.id}
                    id={`prompt-${row.question.id}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="scroll-mt-28 rounded-3xl bg-cream-deep/45 p-3.5 lg:flex lg:items-center lg:gap-4"
                  >
                    <div className="mb-3 min-w-0 flex-1 lg:mb-0">
                      <p className="text-sm leading-snug font-semibold">
                        <span className="mr-1.5 font-heading text-sky-700">Q{position.get(row.question.id)}</span>
                        {row.question.text}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                        <Badge variant="outline" className="bg-white/70">
                          {INTENT_LABELS[row.question.intent]}
                        </Badge>
                        {row.question.topic && (
                          <Badge variant="outline" className="border-sun-200 bg-sun-100 text-[#8a5f12]">
                            {row.question.topic}
                          </Badge>
                        )}
                        {missingEverywhere.has(row.question.id) && <Badge variant="blush">Missing everywhere</Badge>}
                        {rivals.length > 0 && <span>Recommended: {listJoin(rivals)}</span>}
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {report.models.map((model) => (
                        <Cell
                          key={model}
                          model={model}
                          row={row}
                          product={report.brief.product}
                          answer={answerFor(row.question.id, model)}
                          failed={failedFor(row.question.id, model)}
                          onOpen={onOpenAnswer}
                        />
                      ))}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>

          {shown.pages > 1 && (
            <nav aria-label="Question pages" className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-soft tabular-nums">
                {shown.start + 1}–{shown.start + shown.items.length} of {rows.length} questions
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={shown.page === 0} onClick={() => turnTo(shown.page - 1)} aria-label="Previous page">
                  <Icon icon={ArrowLeft01Icon} className="size-4" />
                  <span className="hidden sm:inline">Previous</span>
                </Button>
                <span className="text-sm font-semibold tabular-nums">
                  {shown.page + 1} / {shown.pages}
                </span>
                <Button variant="outline" size="sm" disabled={shown.page >= shown.pages - 1} onClick={() => turnTo(shown.page + 1)} aria-label="Next page">
                  <span className="hidden sm:inline">Next</span>
                  <Icon icon={ArrowRight01Icon} className="size-4" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </SectionCard>
  );
}
