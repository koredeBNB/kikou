"use client";

import { BubbleChatQuestionIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { INTENT_LABELS, listJoin } from "@/lib/format";
import { MODEL_LABELS, type AnalyzedAnswer, type ModelId, type PromptRow, type Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "missing";

function Cell({
  model,
  row,
  product,
  answer,
  onOpen,
}: {
  model: ModelId;
  row: PromptRow;
  product: string;
  answer?: AnalyzedAnswer;
  onOpen: (a: AnalyzedAnswer) => void;
}) {
  const cell = row.cells[model];
  const base = "flex h-9 w-full min-w-[4.5rem] items-center justify-center gap-1 rounded-full pl-0.5 pr-2.5 text-sm font-bold";
  if (!answer || !cell) {
    return (
      <span className={cn(base, "bg-white/60 text-ink-soft")} aria-label={`${MODEL_LABELS[model]}: no answer`}>
        <ModelBadge model={model} className="size-7 opacity-50" />
        n/a
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

export function PromptsCard({ report, onOpenAnswer }: { report: Report; onOpenAnswer: (answer: AnalyzedAnswer) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const missingCells = report.prompts.reduce((s, p) => s + Object.values(p.cells).filter((c) => c && !c.mentioned).length, 0);
  const rows = report.prompts.filter((p) => filter === "all" || p.productMentions < p.answers);
  const answerFor = (questionId: string, model: ModelId) => report.answers.find((a) => a.questionId === questionId && a.model === model);
  const missingEverywhere = new Set(report.missingPrompts);

  return (
    <SectionCard
      id="prompts"
      icon={BubbleChatQuestionIcon}
      tint="bg-lavender-100 text-[#5f4bb0]"
      title="Prompt by prompt"
      description={`Every question and every answer. You're missing from ${missingCells} of ${report.totalAnswers} answers${report.missingPrompts.length ? `, and no assistant mentions you for ${report.missingPrompts.length} question${report.missingPrompts.length === 1 ? "" : "s"}` : ""}.`}
      action={
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" spacing={1} className="hidden sm:flex">
          <ToggleGroupItem value="all" className="h-8 rounded-full px-3 text-xs font-bold">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="missing" className="h-8 rounded-full px-3 text-xs font-bold">
            Where you&apos;re missing
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" spacing={1} className="mb-4 sm:hidden">
        <ToggleGroupItem value="all" className="h-8 rounded-full px-3 text-xs font-bold">
          All
        </ToggleGroupItem>
        <ToggleGroupItem value="missing" className="h-8 rounded-full px-3 text-xs font-bold">
          Where you&apos;re missing
        </ToggleGroupItem>
      </ToggleGroup>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-ink-soft">Every assistant mentioned {report.brief.product} for every question. Lovely!</p>
      ) : (
        <ol className="space-y-2.5">
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const index = report.questions.findIndex((q) => q.id === row.question.id);
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
                      <span className="mr-1.5 font-heading text-sky-700">Q{index + 1}</span>
                      {row.question.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <Badge variant="outline" className="bg-white/70">
                        {INTENT_LABELS[row.question.intent]}
                      </Badge>
                      {missingEverywhere.has(row.question.id) && <Badge variant="blush">Missing everywhere</Badge>}
                      {rivals.length > 0 && <span>Recommended: {listJoin(rivals)}</span>}
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {report.models.map((model) => (
                      <Cell key={model} model={model} row={row} product={report.brief.product} answer={answerFor(row.question.id, model)} onOpen={onOpenAnswer} />
                    ))}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </SectionCard>
  );
}
