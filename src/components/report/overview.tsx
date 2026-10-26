"use client";

import {
  AiChat02Icon,
  Award01Icon,
  Calendar03Icon,
  ChartRingIcon,
  Download01Icon,
  Link01Icon,
  PieChartIcon,
  PlusSignIcon,
  RankingIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { MODEL_COLORS, ModelBadge } from "@/components/art/model-badge";
import { Pip } from "@/components/art/pip";
import { Icon } from "@/components/icon";
import { Dot, Meter, OTHERS_COLOR, SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { listJoin, ordinal, pct, rankLabel } from "@/lib/format";
import type { StoredRun } from "@/lib/sov/storage";
import { MODEL_LABELS, type ModelId, type Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

export function runSource(run: StoredRun): "live" | "mock" | "mixed" {
  const sources = new Set(run.answers.map((a) => a.source));
  return sources.size === 1 ? [...sources][0] : "mixed";
}

function downloadJson(run: StoredRun, report: Report) {
  const blob = new Blob([JSON.stringify({ run, report }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.brief.product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-share-of-voice.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportHeader({ run, report }: { run: StoredRun; report: Report }) {
  const { brief } = report;
  const source = runSource(run);
  const date = new Date(run.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-bold text-meadow-700">Share-of-voice report</p>
        <h1 className="mt-1 text-4xl font-semibold text-ink sm:text-5xl">{brief.product}</h1>
        <p className="mt-2 text-base text-ink-soft">
          {brief.category}
          {brief.audience && <> for {brief.audience}</>}
          {brief.competitors.length > 0 && <> · tracking {listJoin(brief.competitors)}</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="h-6 bg-white/70 px-2.5">
            <Icon icon={Calendar03Icon} className="size-3.5" />
            {date}
          </Badge>
          <Badge variant="outline" className="h-6 bg-white/70 px-2.5">
            {report.totalAnswers} answers · {report.questions.length} questions · {report.models.length} assistants
          </Badge>
          {source === "live" ? (
            <Badge variant="meadow" className="h-6 px-2.5">Live answers</Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="sun" className="h-6 cursor-help px-2.5">
                  {source === "mock" ? "Demo answers" : "Live + demo answers"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                Assistants without an API key answer with realistic sample text, so you can try every feature for free.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="no-print flex shrink-0 gap-2">
        <Button variant="outline" onClick={() => downloadJson(run, report)}>
          <Icon icon={Download01Icon} />
          Download data
        </Button>
        <Button asChild>
          <Link href="/">
            <Icon icon={PlusSignIcon} strokeWidth={2.4} />
            New check
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function VerdictBanner({ run, report }: { run: StoredRun; report: Report }) {
  const { product, brief } = report;
  const leader = report.brands[0];
  const byRate = [...report.modelSummaries].sort((a, b) => b.productMentionRate - a.productMentionRate);
  const best = byRate[0];
  const worst = byRate.at(-1);
  const headline =
    product.mentions === 0
      ? `None of the assistants mentioned ${brief.product} yet.`
      : report.productPosition === 1
        ? `${brief.product} leads share of voice and shows up in ${pct(product.mentionRate)} of answers.`
        : `${brief.product} shows up in ${pct(product.mentionRate)} of answers, but ${leader.brand} leads share of voice.`;
  const detail =
    best && worst && best.model !== worst.model && best.productMentionRate !== worst.productMentionRate
      ? `${MODEL_LABELS[best.model]} recommends you most often (${pct(best.productMentionRate)}); ${MODEL_LABELS[worst.model]} is your biggest opportunity (${pct(worst.productMentionRate)}).`
      : `Assistants mention you at a similar rate across the board.`;
  const demo = runSource(run) !== "live";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22, delay: 0.05 }}
      className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-r from-sun-100 via-[#FFF6DD] to-meadow-50 p-5 shadow-[var(--shadow-pillow)] sm:p-6"
    >
      <div aria-hidden className="absolute -top-10 -right-10 size-40 rounded-full bg-white/50 blur-2xl" />
      <div className="relative flex items-center gap-4">
        <Pip mood={report.productPosition === 1 ? "happy" : "wave"} className="size-16 shrink-0 sm:size-20" />
        <div className="min-w-0">
          <p className="font-heading text-lg leading-snug font-semibold text-ink sm:text-xl">{headline}</p>
          <p className="mt-1 text-sm text-ink-soft sm:text-base">{detail}</p>
          {(demo || run.errors.length > 0) && (
            <p className="mt-2 text-sm font-semibold text-[#8a5a12]">
              {demo && "These are demo answers. Add API keys (see the README) to ask the real assistants."}
              {demo && run.errors.length > 0 && " "}
              {run.errors.length > 0 && `${run.errors.length} answer${run.errors.length === 1 ? "" : "s"} failed and ${run.errors.length === 1 ? "is" : "are"} left out.`}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Kpi({ icon, tint, value, label, note, help }: { icon: IconSvgElement; tint: string; value: string; label: string; note: string; help: string }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3.5">
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", tint)}>
        <Icon icon={icon} className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="font-heading text-2xl leading-none font-semibold tabular-nums">{value}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="mt-1 cursor-help text-sm font-semibold text-ink decoration-dotted underline-offset-3 hover:underline">{label}</p>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{help}</TooltipContent>
        </Tooltip>
        <p className="text-xs text-ink-soft">{note}</p>
      </div>
    </div>
  );
}

export function KpiStack({ report }: { report: Report }) {
  const { product } = report;
  const ownCitations = report.domains.filter((d) => d.isOwn).reduce((s, d) => s + d.count, 0);
  return (
    <Card id="overview" className="h-full scroll-mt-24 gap-0 divide-y divide-border/60 py-1.5">
      <Kpi
        icon={PieChartIcon}
        tint="bg-meadow-100 text-meadow-700"
        value={pct(product.shareOfVoice)}
        label="Share of voice"
        note={`${ordinal(report.productPosition)} of ${report.brands.length} brands`}
        help="Your mentions divided by all brand mentions across every answer."
      />
      <Kpi
        icon={Target02Icon}
        tint="bg-sky-100 text-sky-700"
        value={pct(product.mentionRate)}
        label="Mention rate"
        note={`${product.mentions} of ${report.totalAnswers} answers`}
        help="The share of answers that mention you at least once."
      />
      <Kpi
        icon={RankingIcon}
        tint="bg-sun-100 text-[#a86f12]"
        value={rankLabel(product.avgRank)}
        label="Average position"
        note={product.mentions ? "when you're mentioned" : "not mentioned yet"}
        help="Your average place in the list of brands, by order of first mention. #1 is best."
      />
      <Kpi
        icon={Award01Icon}
        tint="bg-blush-100 text-[#a5463d]"
        value={String(product.firstPlace)}
        label="First-place answers"
        note="where you're named first"
        help="Answers where you are the first brand the assistant names."
      />
      <Kpi
        icon={Link01Icon}
        tint="bg-lavender-100 text-[#5f4bb0]"
        value={String(report.totalCitations)}
        label="Sources cited"
        note={report.brief.website ? `${ownCitations} from your site` : `${report.domains.length} domains`}
        help="Links the assistants gave as sources. Assistants without web access cite fewer."
      />
    </Card>
  );
}

type Scope = "all" | ModelId;

export function ShareOfVoiceCard({ report, colors }: { report: Report; colors: Map<string, string> }) {
  const [scope, setScope] = useState<Scope>("all");
  const { slices, config, productShare } = useMemo(() => {
    const value = (b: Report["brands"][number]) => (scope === "all" ? b.shareOfVoice : b.byModel[scope].shareOfVoice);
    const ranked = [...report.brands].filter((b) => value(b) > 0).sort((a, b) => value(b) - value(a));
    const top = ranked.slice(0, 6);
    const rest = ranked.slice(6).reduce((s, b) => s + value(b), 0);
    const slices = [
      ...top.map((b, i) => ({ key: `b${i}`, brand: b.brand, value: value(b), color: colors.get(b.brand) ?? OTHERS_COLOR, isProduct: b.isProduct })),
      ...(rest > 0 ? [{ key: "others", brand: "Others", value: rest, color: OTHERS_COLOR, isProduct: false }] : []),
    ];
    const config = Object.fromEntries(slices.map((s) => [s.key, { label: s.brand, color: s.color }])) satisfies ChartConfig;
    return { slices, config, productShare: value(report.product) };
  }, [report, scope, colors]);

  return (
    <SectionCard
      id="share-of-voice"
      icon={ChartRingIcon}
      tint="bg-meadow-100 text-meadow-700"
      title="Share of voice"
      description="Who gets talked about when buyers ask"
    >
      <ToggleGroup
        type="single"
        value={scope}
        onValueChange={(v) => v && setScope(v as Scope)}
        variant="outline"
        spacing={1}
        className="mb-4 flex-wrap"
      >
        <ToggleGroupItem value="all" className="h-8 rounded-full px-3 text-xs font-bold">
          All assistants
        </ToggleGroupItem>
        {report.models.map((m) => (
          <ToggleGroupItem key={m} value={m} className="h-8 rounded-full px-2.5 text-xs font-bold" aria-label={MODEL_LABELS[m]}>
            <ModelBadge model={m} className="size-5" />
            <span className="hidden sm:inline">{MODEL_LABELS[m]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {slices.length === 0 ? (
        <p className="py-12 text-center text-ink-soft">No brands were mentioned{scope === "all" ? "" : ` by ${MODEL_LABELS[scope]}`}.</p>
      ) : (
        <div className="grid items-center gap-5 sm:grid-cols-[220px_1fr]">
          <div className="relative mx-auto size-[220px]">
            <ChartContainer config={config} className="aspect-square size-full" initialDimension={{ width: 220, height: 220 }}>
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" formatter={(v, _n, item) => (
                  <span className="flex items-center gap-2">
                    <Dot color={item.payload.color} />
                    <span className="font-semibold">{item.payload.brand}</span>
                    <span className="ml-auto pl-3 font-bold tabular-nums">{pct(Number(v))}</span>
                  </span>
                )} />} />
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="key"
                  innerRadius={68}
                  outerRadius={104}
                  paddingAngle={2.5}
                  cornerRadius={10}
                  strokeWidth={0}
                  animationDuration={700}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <Pip mood="happy" still className="size-12" />
              <span className="font-heading text-2xl leading-none font-semibold tabular-nums text-meadow-700">{pct(productShare)}</span>
              <span className="text-[0.7rem] font-bold text-ink-soft">{report.brief.product}</span>
            </div>
          </div>
          <ul className="space-y-2.5">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 text-sm">
                <Dot color={s.color} />
                <span className={cn("w-24 truncate font-semibold sm:w-28", s.isProduct && "text-meadow-700")}>{s.brand}</span>
                <Meter value={s.value / slices[0].value} color={s.color} />
                <span className="w-10 text-right font-bold tabular-nums">{pct(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

export function AssistantsGlance({ report }: { report: Report }) {
  return (
    <SectionCard icon={AiChat02Icon} tint="bg-lavender-100 text-[#5f4bb0]" title="By assistant" description="How often each one mentions you">
      <ul className="space-y-4">
        {report.modelSummaries.map((m) => (
          <li key={m.model}>
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <ModelBadge model={m.model} className="size-7" />
              <span className="font-semibold">{MODEL_LABELS[m.model]}</span>
              <span className="ml-auto font-bold tabular-nums">{pct(m.productMentionRate)}</span>
            </div>
            <Meter value={m.productMentionRate} color={MODEL_COLORS[m.model].solid} className="h-2" />
            <p className="mt-1 text-xs text-ink-soft">
              {m.productAvgRank === null ? "Not in its lists yet" : `Avg. position ${rankLabel(m.productAvgRank)}`}
              {m.topBrand && m.topBrand !== report.brief.product && <> · favours {m.topBrand}</>}
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
