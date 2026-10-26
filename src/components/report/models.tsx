"use client";

import { CrownIcon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { MODEL_COLORS, ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Reveal } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { pct, rankLabel } from "@/lib/format";
import type { ProviderStatus } from "@/lib/providers/config";
import { MODEL_LABELS, type ModelSummary, type Report } from "@/lib/sov/types";

function Ring({ value, color, track }: { value: number; color: string; track: string }) {
  return (
    <svg viewBox="0 0 120 120" className="size-28 -rotate-90" aria-hidden>
      <circle cx="60" cy="60" r="48" fill="none" stroke={track} strokeWidth="14" />
      <motion.circle
        cx="60"
        cy="60"
        r="48"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: Math.max(value, 0.001) }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease: "easeOut" }}
      />
    </svg>
  );
}

function ModelCard({ summary, status, report }: { summary: ModelSummary; status?: ProviderStatus; report: Report }) {
  const colors = MODEL_COLORS[summary.model];
  const youLead = summary.topBrand === report.brief.product;
  const stats = [
    { label: "Avg. position", value: rankLabel(summary.productAvgRank) },
    { label: "Share", value: pct(summary.productShareOfVoice) },
    { label: "Sources", value: String(summary.citations) },
  ];
  return (
    <Card className="h-full gap-4 px-5">
      <div className="flex items-center gap-2.5">
        <ModelBadge model={summary.model} className="size-10" />
        <div className="min-w-0">
          <p className="font-heading text-lg leading-tight font-semibold">{MODEL_LABELS[summary.model]}</p>
          <p className="truncate text-xs text-ink-soft">
            {summary.answers} answers{status?.modelName ? ` · ${status.modelName}` : ""}
            {status?.via === "openrouter" ? " via OpenRouter" : ""}
          </p>
        </div>
        <Badge variant={summary.source === "live" ? "meadow" : "sun"} className="ml-auto">
          {summary.source === "live" ? "Live" : summary.source === "mock" ? "Demo" : "Mixed"}
        </Badge>
      </div>
      <div className="relative mx-auto">
        <Ring value={summary.productMentionRate} color={colors.solid} track={colors.bg} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-heading text-2xl leading-none font-semibold tabular-nums" style={{ color: colors.ink }}>
            {pct(summary.productMentionRate)}
          </span>
          <span className="text-[0.65rem] font-bold text-ink-soft">mention rate</span>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-1.5">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse items-center rounded-2xl bg-white/80 px-1 py-2 text-center ring-1 ring-border/50">
            <dt className="text-[0.7rem] leading-tight text-ink-soft">{s.label}</dt>
            <dd className="font-heading text-lg leading-tight font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto space-y-2 text-sm">
        <p className="flex items-center gap-1.5">
          <Icon icon={CrownIcon} className={youLead ? "size-4 text-sun-500" : "size-4 text-ink-soft"} />
          <span className="text-ink-soft">Top pick:</span>
          <span className={youLead ? "font-bold text-meadow-700" : "font-semibold"}>{summary.topBrand ?? "nobody yet"}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {summary.topDomains.length ? (
            summary.topDomains.map((d) => (
              <span key={d} className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: colors.bg, color: colors.ink }}>
                {d}
              </span>
            ))
          ) : (
            <span className="text-xs text-ink-soft">No sources cited</span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ModelBreakdown({ report, statuses }: { report: Report; statuses: ProviderStatus[] }) {
  return (
    <section id="assistants" className="scroll-mt-24">
      <div className="mb-3 px-1">
        <h2 className="text-2xl font-semibold">Assistant by assistant</h2>
        <p className="text-ink-soft">Each assistant has its own favourites. Here&apos;s how you fare with each one.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {report.modelSummaries.map((s, i) => (
          <Reveal key={s.model} delay={i * 0.06} className="h-full">
            <ModelCard summary={s} report={report} status={statuses.find((p) => p.id === s.model)} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
