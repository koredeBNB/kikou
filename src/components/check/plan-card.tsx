"use client";

import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { INTENT_LABELS } from "@/lib/format";
import type { ProviderStatus } from "@/lib/providers/config";
import { MODEL_IDS, MODEL_LABELS, type Brief, type ModelId, type Question } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

export interface PlannedQuestion {
  question: Question;
  enabled: boolean;
}

export function PlanCard({
  brief,
  planned,
  models,
  providers,
  locked,
  onToggleQuestion,
  onRemoveQuestion,
  onToggleModel,
  onStart,
}: {
  brief: Brief;
  planned: PlannedQuestion[];
  models: Record<ModelId, boolean>;
  providers: ProviderStatus[];
  locked: boolean;
  onToggleQuestion: (id: string) => void;
  onRemoveQuestion: (id: string) => void;
  onToggleModel: (id: ModelId) => void;
  onStart: () => void;
}) {
  const enabledQuestions = planned.filter((p) => p.enabled).length;
  const enabledModels = MODEL_IDS.filter((m) => models[m]).length;
  const sourceOf = (id: ModelId) => providers.find((p) => p.id === id)?.source ?? "mock";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-sm">
        <Badge variant="meadow" className="h-6 px-2.5">{brief.product}</Badge>
        <Badge variant="sky" className="h-6 px-2.5">{brief.category}</Badge>
        <Badge variant="lavender" className="h-6 px-2.5">for {brief.audience}</Badge>
        {brief.competitors.map((c) => (
          <Badge key={c} variant="outline" className="h-6 bg-white px-2.5">
            vs {c}
          </Badge>
        ))}
      </div>

      <ul className="space-y-1.5">
        {planned.map(({ question, enabled }, index) => (
          <li
            key={question.id}
            className={cn(
              "group flex items-start gap-3 rounded-2xl border border-transparent px-3 py-2.5 transition",
              enabled ? "bg-sky-50/80" : "bg-transparent opacity-55",
              !locked && "hover:border-sky-200",
            )}
          >
            <Checkbox
              id={`q-${question.id}`}
              checked={enabled}
              disabled={locked}
              onCheckedChange={() => onToggleQuestion(question.id)}
              className="mt-0.5 size-5 rounded-md bg-white data-[state=checked]:border-meadow-600 data-[state=checked]:bg-meadow-600"
            />
            <label htmlFor={`q-${question.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="mr-2 font-heading text-sm font-semibold text-sky-700">{index + 1}.</span>
              <span className="text-[0.95rem]">{question.text}</span>
              <span className="ml-2 inline-block align-middle text-[0.7rem] font-bold tracking-wide text-ink-soft/80 uppercase">
                {INTENT_LABELS[question.intent]}
              </span>
            </label>
            {question.intent === "custom" && !locked && (
              <button
                type="button"
                onClick={() => onRemoveQuestion(question.id)}
                className="rounded-full p-1 text-ink-soft opacity-0 transition group-hover:opacity-100 hover:bg-blush-100 hover:text-blush-500 focus-visible:opacity-100"
                aria-label="Remove question"
              >
                <Icon icon={Cancel01Icon} className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-soft">Ask these assistants</p>
        <div className="flex flex-wrap gap-2">
          {MODEL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              disabled={locked}
              aria-pressed={models[id]}
              onClick={() => onToggleModel(id)}
              className={cn(
                "flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-sm font-semibold transition active:scale-95",
                models[id]
                  ? "border-meadow-200 bg-white text-ink shadow-[0_4px_12px_-8px_rgb(59_127_63/0.8)]"
                  : "border-dashed border-border bg-transparent text-ink-soft opacity-60",
              )}
            >
              <ModelBadge model={id} className="size-7" />
              {MODEL_LABELS[id]}
              <span className={cn("text-[0.68rem] font-bold uppercase", sourceOf(id) === "live" ? "text-meadow-600" : "text-[#b07a1c]")}>
                {sourceOf(id) === "live" ? "live" : "demo"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button size="lg" onClick={onStart} disabled={enabledQuestions === 0 || enabledModels === 0}>
            <Icon icon={PlayIcon} className="size-4.5" />
            Ask {enabledModels} assistant{enabledModels === 1 ? "" : "s"} · {enabledQuestions * enabledModels} answers
          </Button>
          <p className="text-sm text-ink-soft">Type below to add your own question.</p>
        </div>
      )}
    </div>
  );
}
