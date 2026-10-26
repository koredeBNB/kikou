"use client";

import { Link01Icon } from "@hugeicons/core-free-icons";
import { AnswerText } from "@/components/answer/answer-text";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collectCitations } from "@/lib/sov/citations";
import { MODEL_LABELS, type ModelAnswer } from "@/lib/sov/types";

export interface AnswerDialogProps {
  answer: ModelAnswer | null;
  questionText: string;
  product: string;
  rivals: string[];
  rank?: number | null;
  onOpenChange: (open: boolean) => void;
}

export function AnswerDialog({ answer, questionText, product, rivals, rank, onOpenChange }: AnswerDialogProps) {
  const citations = answer ? collectCitations(answer.text, answer.citations) : [];
  return (
    <Dialog open={Boolean(answer)} onOpenChange={onOpenChange}>
      <DialogContent className="pillow max-h-[88vh] gap-0 overflow-hidden rounded-[2rem] p-0 sm:max-w-2xl">
        {answer && (
          <>
            <DialogHeader className="border-b border-border/70 bg-gradient-to-b from-sky-50 to-transparent px-6 pt-6 pb-4 text-left">
              <div className="flex flex-wrap items-center gap-2.5 pr-10">
                <ModelBadge model={answer.model} className="size-9" />
                <span className="font-heading text-lg font-semibold">{MODEL_LABELS[answer.model]}</span>
                <Badge variant={answer.source === "live" ? "meadow" : "sun"}>{answer.source === "live" ? "Live answer" : "Demo answer"}</Badge>
                {rank !== undefined && (
                  <Badge variant={rank ? "meadow" : "blush"} className="ml-auto">
                    {rank ? `${product} at #${rank}` : `${product} not mentioned`}
                  </Badge>
                )}
              </div>
              <DialogTitle className="pt-3 text-xl leading-snug font-semibold">“{questionText}”</DialogTitle>
              <DialogDescription>
                {(answer.latencyMs / 1000).toFixed(1)}s to answer · {citations.length} source{citations.length === 1 ? "" : "s"} cited
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="px-6 py-4">
                <AnswerText text={answer.text} product={product} rivals={rivals} />
                {citations.length > 0 && (
                  <div className="mt-5 rounded-2xl bg-lavender-100/60 p-4">
                    <p className="mb-2 font-heading text-sm font-semibold text-lavender-500">Sources</p>
                    <ol className="space-y-1.5 text-sm">
                      {citations.map((c, i) => (
                        <li key={c.url} className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[0.7rem] font-bold text-lavender-500">
                            {i + 1}
                          </span>
                          <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 break-all text-ink hover:text-sky-700">
                            <span className="font-semibold">{c.domain}</span>
                            <span className="text-ink-soft"> {c.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70)}</span>
                          </a>
                          <Icon icon={Link01Icon} className="mt-0.5 size-3.5 text-ink-soft" />
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
