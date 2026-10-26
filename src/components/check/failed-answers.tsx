"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import type { RunError } from "@/lib/sov/storage";
import { MODEL_LABELS, type Question } from "@/lib/sov/types";

const PREVIEW = 5;

export function FailedAnswers({ errors, questions }: { errors: RunError[]; questions: Question[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (errors.length === 0) return null;
  const text = new Map(questions.map((q) => [q.id, q.text]));
  const shown = all ? errors : errors.slice(0, PREVIEW);

  return (
    <div className="rounded-2xl bg-blush-100/60 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Icon icon={Alert02Icon} className="size-4 shrink-0 text-blush-500" />
        <p className="min-w-0 flex-1 font-semibold text-ink">
          {errors.length} answer{errors.length === 1 ? "" : "s"} failed, so {errors.length === 1 ? "it's" : "they're"} left out of the results.
        </p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5 pb-1">
          {shown.map((error) => (
            <li key={`${error.model}-${error.questionId}`} className="flex items-start gap-2">
              <ModelBadge model={error.model} className="size-6 shrink-0" />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block truncate text-ink">{text.get(error.questionId) ?? error.questionId}</span>
                <span className="block text-xs text-ink-soft">
                  {MODEL_LABELS[error.model]}: {error.message}
                </span>
              </span>
            </li>
          ))}
          {errors.length > PREVIEW && (
            <li>
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${errors.length}`}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
