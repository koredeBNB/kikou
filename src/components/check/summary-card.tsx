"use client";

import { ArrowRight01Icon, Idea01Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { ordinal, pct, rankLabel } from "@/lib/format";
import { MODEL_LABELS, type Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

export function SummaryCard({
  report,
  onOpenReport,
  onRestart,
}: {
  report: Report;
  onOpenReport: () => void;
  onRestart: () => void;
}) {
  const { product } = report;
  const top = report.brands.slice(0, 5);
  const max = Math.max(...top.map((b) => b.shareOfVoice), 0.01);
  const tip = report.recommendations[0];

  const stats = [
    { label: "Share of voice", value: pct(product.shareOfVoice), note: `${ordinal(report.productPosition)} of ${report.brands.length} brands`, tint: "bg-meadow-100 text-meadow-700" },
    { label: "Mention rate", value: pct(product.mentionRate), note: `${product.mentions} of ${report.totalAnswers} answers`, tint: "bg-sky-100 text-sky-700" },
    { label: "Avg. position", value: rankLabel(product.avgRank), note: product.firstPlace ? `#1 in ${product.firstPlace} answer${product.firstPlace === 1 ? "" : "s"}` : "never first yet", tint: "bg-sun-100 text-[#8a5a12]" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 320, damping: 22 }}
            className={cn("rounded-3xl px-3 py-3 text-center sm:px-4", s.tint)}
          >
            <p className="font-heading text-2xl font-semibold sm:text-3xl">{s.value}</p>
            <p className="text-xs font-bold sm:text-sm">{s.label}</p>
            <p className="mt-0.5 text-[0.7rem] opacity-80 sm:text-xs">{s.note}</p>
          </motion.div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-soft">Share of voice, all assistants</p>
        <ul className="space-y-1.5">
          {top.map((b, i) => (
            <li key={b.brand} className="flex items-center gap-3 text-sm">
              <span className={cn("w-28 truncate font-semibold sm:w-36", b.isProduct && "text-meadow-700")}>{b.brand}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-[#F1E7D4]">
                <motion.span
                  className={cn("block h-full rounded-full", b.isProduct ? "bg-gradient-to-r from-meadow-300 to-meadow-500" : "bg-gradient-to-r from-sky-200 to-sky-300")}
                  initial={{ width: 0 }}
                  animate={{ width: `${(b.shareOfVoice / max) * 100}%` }}
                  transition={{ delay: 0.25 + i * 0.07, duration: 0.7, ease: "easeOut" }}
                />
              </span>
              <span className="w-10 text-right font-bold tabular-nums">{pct(b.shareOfVoice)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        {report.modelSummaries.map((m) => (
          <span key={m.model} className="flex items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-sm shadow-[0_4px_12px_-9px_rgb(73_88_120/0.7)]">
            <ModelBadge model={m.model} className="size-7" />
            <span className="font-semibold">{MODEL_LABELS[m.model]}</span>
            <span className={cn("font-bold tabular-nums", m.productMentionRate >= 0.5 ? "text-meadow-700" : m.productMentionRate > 0 ? "text-[#a86f12]" : "text-blush-500")}>
              {pct(m.productMentionRate)}
            </span>
          </span>
        ))}
      </div>

      {tip && (
        <div className="flex gap-3 rounded-3xl bg-sun-100/80 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#b07a1c]">
            <Icon icon={Idea01Icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-heading font-semibold">Pip&apos;s first tip: {tip.title}</p>
            <p className="text-sm text-ink-soft">{tip.detail}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onOpenReport}>
          Open the full report
          <Icon icon={ArrowRight01Icon} className="size-4.5" strokeWidth={2.4} />
        </Button>
        <Button size="lg" variant="outline" onClick={onRestart}>
          <Icon icon={RepeatIcon} className="size-4.5" />
          Check another product
        </Button>
      </div>
    </div>
  );
}
