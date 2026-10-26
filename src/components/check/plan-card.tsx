"use client";

import { Cancel01Icon, Coins01Icon, Globe02Icon, PencilEdit02Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { Fragment, useState } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { INTENT_LABELS } from "@/lib/format";
import type { ProviderStatus } from "@/lib/providers/config";
import { formatUsd, estimateSummary, type Estimate } from "@/lib/sov/estimate";
import { previewIndexes } from "@/lib/sov/preview";
import { MODEL_IDS, MODEL_LABELS, type Brief, type ModelId, type Question } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

export interface PlannedQuestion {
  question: Question;
  enabled: boolean;
}

/** Longer plans start collapsed to this many questions. */
const COLLAPSED = 8;

export function PlanCard({
  brief,
  planned,
  models,
  providers,
  locked,
  webSearch,
  canSwitchSearch,
  estimate,
  budget,
  budgetNote,
  onToggleQuestion,
  onRemoveQuestion,
  onEditQuestion,
  onToggleModel,
  onToggleWebSearch,
  onStart,
}: {
  brief: Brief;
  planned: PlannedQuestion[];
  models: Record<ModelId, boolean>;
  providers: ProviderStatus[];
  locked: boolean;
  webSearch: boolean;
  canSwitchSearch: boolean;
  estimate: Estimate;
  budget: { limitUsd: number; remainingUsd: number } | null;
  budgetNote: string | null;
  onToggleQuestion: (id: string) => void;
  onRemoveQuestion: (id: string) => void;
  onEditQuestion: (id: string, text: string) => void;
  onToggleModel: (id: ModelId) => void;
  onToggleWebSearch: (on: boolean) => void;
  onStart: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const enabledQuestions = planned.filter((p) => p.enabled).length;
  const enabledModels = MODEL_IDS.filter((m) => models[m]).length;
  const sourceOf = (id: ModelId) => providers.find((p) => p.id === id)?.source ?? "mock";
  const topics = brief.topics ?? [];
  const collapsible = planned.length > COLLAPSED + 2;
  const shown = (
    collapsible && !expanded ? previewIndexes(planned.map((p) => p.question), COLLAPSED) : planned.map((_, i) => i)
  ).map((index) => ({ ...planned[index], index }));

  const beginEdit = (question: Question) => {
    setEditing(question.id);
    setDraft(question.text);
  };
  const commitEdit = () => {
    if (editing && draft.trim()) onEditQuestion(editing, draft.trim());
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-sm">
        <Badge variant="meadow" className="h-6 px-2.5">{brief.product}</Badge>
        <Badge variant="sky" className="h-6 px-2.5">{brief.category}</Badge>
        {brief.audience && <Badge variant="lavender" className="h-6 px-2.5">for {brief.audience}</Badge>}
        {brief.competitors.map((c) => (
          <Badge key={c} variant="outline" className="h-6 bg-white px-2.5">
            vs {c}
          </Badge>
        ))}
        {topics.map((t) => (
          <Badge key={t} variant="outline" className="h-6 border-sun-200 bg-sun-100 px-2.5 text-[#8a5f12]">
            {t}
          </Badge>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink-soft">
          {planned.length} question{planned.length === 1 ? "" : "s"}
          {topics.length > 0 && <> · split across {topics.length} topic{topics.length === 1 ? "" : "s"}</>}
        </p>
        {collapsible && (
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show fewer" : `Show all ${planned.length}`}
          </Button>
        )}
      </div>

      <ul className="space-y-1.5">
        {shown.map(({ question, enabled, index }, at) => {
          const groupStart = topics.length > 0 && question.topic !== shown[at - 1]?.question.topic;
          const isEditing = editing === question.id;
          return (
            <Fragment key={question.id}>
              {groupStart && (
                <li className="px-1 pt-2 font-heading text-sm font-semibold text-[#8a5f12] first:pt-0">
                  {question.topic ?? "Your questions"}
                </li>
              )}
              <li
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
                  aria-label={`Ask question ${index + 1}`}
                />
                {isEditing ? (
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={300}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-8 flex-1 bg-white"
                    aria-label={`Edit question ${index + 1}`}
                  />
                ) : (
                  <label htmlFor={`q-${question.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="mr-2 font-heading text-sm font-semibold text-sky-700">{index + 1}.</span>
                    <span className="text-[0.95rem]">{question.text}</span>
                    <span className="ml-2 inline-block align-middle text-[0.7rem] font-bold tracking-wide text-ink-soft/80 uppercase">
                      {INTENT_LABELS[question.intent]}
                    </span>
                  </label>
                )}
                {!locked && !isEditing && (
                  <span className="flex shrink-0 gap-0.5 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => beginEdit(question)}
                      className="rounded-full p-1 text-ink-soft hover:bg-sky-100 hover:text-sky-700"
                      aria-label={`Edit question ${index + 1}`}
                    >
                      <Icon icon={PencilEdit02Icon} className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveQuestion(question.id)}
                      className="rounded-full p-1 text-ink-soft hover:bg-blush-100 hover:text-blush-500"
                      aria-label={`Remove question ${index + 1}`}
                    >
                      <Icon icon={Cancel01Icon} className="size-3.5" />
                    </button>
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
        {collapsible && !expanded && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full rounded-2xl border border-dashed border-sky-200 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              + {planned.length - COLLAPSED} more question{planned.length - COLLAPSED === 1 ? "" : "s"}
            </button>
          </li>
        )}
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

      {canSwitchSearch && (
        <label className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5">
          <Icon icon={Globe02Icon} className="size-5 shrink-0 text-sky-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Search the web</span>
            <span className="block text-xs text-ink-soft">Fresher answers with sources. Off is much cheaper; Perplexity always searches.</span>
          </span>
          <Switch checked={webSearch} disabled={locked} onCheckedChange={onToggleWebSearch} aria-label="Search the web" />
        </label>
      )}

      <div className={cn("rounded-2xl px-3 py-2.5", budgetNote ? "bg-blush-100/70" : "bg-meadow-50")}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Icon icon={Coins01Icon} className="size-4.5 shrink-0 text-meadow-700" />
          <span>{estimateSummary(estimate)}</span>
        </p>
        {(budgetNote || budget) && (
          <p className={cn("mt-1 pl-6.5 text-xs", budgetNote ? "font-semibold text-blush-500" : "text-ink-soft")}>
            {budgetNote ?? `${formatUsd(budget!.remainingUsd)} of today's ${formatUsd(budget!.limitUsd)} budget left.`}
          </p>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button size="lg" onClick={onStart} disabled={enabledQuestions === 0 || enabledModels === 0 || Boolean(budgetNote)}>
            <Icon icon={PlayIcon} className="size-4.5" />
            Ask {enabledModels} assistant{enabledModels === 1 ? "" : "s"} · {enabledQuestions * enabledModels} answers
          </Button>
          <p className="text-sm text-ink-soft">Type below to add your own question.</p>
        </div>
      )}
    </div>
  );
}
