"use client";

import {
  AiChat02Icon,
  AiScanIcon,
  Idea01Icon,
  Link01Icon,
  RankingIcon,
  SmileIcon,
  Target02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { motion } from "motion/react";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Dot, Meter, SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pct, rankLabel } from "@/lib/format";
import type { BrandStats, Recommendation, Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

const AREA_ICONS: Record<Recommendation["area"], { icon: IconSvgElement; tint: string }> = {
  visibility: { icon: Target02Icon, tint: "bg-sky-100 text-sky-700" },
  citations: { icon: Link01Icon, tint: "bg-lavender-100 text-[#5f4bb0]" },
  models: { icon: AiChat02Icon, tint: "bg-meadow-100 text-meadow-700" },
  positioning: { icon: RankingIcon, tint: "bg-sun-100 text-[#a86f12]" },
  sentiment: { icon: SmileIcon, tint: "bg-blush-100 text-[#a5463d]" },
  readability: { icon: AiScanIcon, tint: "bg-sky-100 text-sky-700" },
};

const PRIORITY = {
  high: { label: "Do first", variant: "blush" },
  medium: { label: "Next up", variant: "sun" },
  low: { label: "Keep in mind", variant: "sky" },
} as const;

export function RecommendationsCard({ report }: { report: Report }) {
  return (
    <SectionCard
      id="recommendations"
      icon={Idea01Icon}
      tint="bg-sun-100 text-[#a86f12]"
      title="Pip's next steps"
      description="The changes most likely to get you recommended more"
    >
      {report.recommendations.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">Nothing urgent. Re-run this check after your next launch.</p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.recommendations.map((r, i) => {
            const area = AREA_ICONS[r.area];
            const priority = PRIORITY[r.priority];
            return (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 260, damping: 24, delay: i * 0.05 }}
                whileHover={{ y: -3 }}
                className="flex flex-col gap-2 rounded-3xl bg-white/80 p-4 shadow-[0_8px_22px_-16px_rgb(73_88_120/0.7)] ring-1 ring-border/50"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-8 items-center justify-center rounded-xl", area.tint)}>
                    <Icon icon={area.icon} className="size-4" />
                  </span>
                  <Badge variant={priority.variant}>{priority.label}</Badge>
                </div>
                <p className="font-heading text-base leading-snug font-semibold">{r.title}</p>
                <p className="text-sm leading-relaxed text-ink-soft">{r.detail}</p>
              </motion.li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

export function LeaderboardCard({ report, colors }: { report: Report; colors: Map<string, string> }) {
  const maxRate = Math.max(...report.brands.map((b) => b.mentionRate), 0.01);
  return (
    <SectionCard
      id="rankings"
      icon={RankingIcon}
      tint="bg-sun-100 text-[#a86f12]"
      title="Leaderboard"
      description="Every brand the assistants named, ranked by share of voice"
      contentClassName="px-2 sm:px-4"
    >
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="w-8 pl-3">#</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead className="text-right">Share</TableHead>
            <TableHead className="hidden w-[30%] sm:table-cell">Mention rate</TableHead>
            <TableHead className="text-right">Avg. pos.</TableHead>
            <TableHead className="hidden pr-3 text-right md:table-cell">#1s</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.brands.map((b, i) => (
            <TableRow key={b.brand} className={cn("border-border/40", b.isProduct ? "bg-meadow-50 hover:bg-meadow-100/70" : "hover:bg-sky-50/70")}>
              <TableCell className="pl-3 font-bold text-ink-soft tabular-nums">{i + 1}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Dot color={colors.get(b.brand) ?? "#ccc"} />
                  <span className={cn("font-semibold", b.isProduct && "text-meadow-700")}>{b.brand}</span>
                  {b.isProduct && <Badge variant="meadow">You</Badge>}
                  {b.isTrackedCompetitor && <Badge variant="outline">Tracked</Badge>}
                </span>
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">{pct(b.shareOfVoice)}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="flex items-center gap-2">
                  <Meter value={b.mentionRate / maxRate} color={colors.get(b.brand) ?? "#ccc"} className="h-2" />
                  <span className="w-9 text-right text-xs font-semibold tabular-nums">{pct(b.mentionRate)}</span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{rankLabel(b.avgRank)}</TableCell>
              <TableCell className="hidden pr-3 text-right tabular-nums md:table-cell">{b.firstPlace}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

export function GapsCard({ report, colors }: { report: Report; colors: Map<string, string> }) {
  const order = new Map(report.questions.map((q, i) => [q.id, i + 1]));
  const text = new Map(report.questions.map((q) => [q.id, q.text]));
  const gaps = report.gaps.slice(0, 5);
  const max = Math.max(...gaps.map((g) => g.gapAnswers), 1);
  return (
    <SectionCard
      icon={UserGroupIcon}
      tint="bg-blush-100 text-[#a5463d]"
      title="Competitor gaps"
      description="Answers where a rival is recommended and you aren't"
    >
      {gaps.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">No gaps: whenever a rival came up, so did {report.brief.product}.</p>
      ) : (
        <ul className="space-y-4">
          {gaps.map((g) => (
            <li key={g.competitor}>
              <div className="flex items-center gap-2 text-sm">
                <Dot color={colors.get(g.competitor) ?? "#ccc"} />
                <span className="font-semibold">{g.competitor}</span>
                <span className="ml-auto text-ink-soft">
                  <span className="font-bold text-ink tabular-nums">{g.gapAnswers}</span> answer{g.gapAnswers === 1 ? "" : "s"} without you
                </span>
              </div>
              <Meter value={g.gapAnswers / max} color={colors.get(g.competitor) ?? "#ccc"} className="mt-1.5 h-2" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.questionIds.map((id) => (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <a href={`#prompt-${id}`} className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-ink-soft ring-1 ring-border/70 hover:text-ink">
                        Q{order.get(id)}
                      </a>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">{text.get(id)}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SentimentBar({ stats, className }: { stats: BrandStats; className?: string }) {
  const { positive, neutral, negative } = stats.sentiment;
  const total = positive + neutral + negative;
  if (total === 0) return <span className={cn("block h-3 flex-1 rounded-full bg-[#F1E7D4]", className)} />;
  return (
    <span className={cn("flex h-3 flex-1 gap-0.5 overflow-hidden rounded-full", className)}>
      {[
        [positive, "bg-meadow-300"],
        [neutral, "bg-[#EADFC9]"],
        [negative, "bg-blush-300"],
      ].map(([n, color]) =>
        Number(n) > 0 ? <span key={String(color)} className={cn("h-full", color)} style={{ width: `${(Number(n) / total) * 100}%` }} /> : null,
      )}
    </span>
  );
}

export function SentimentCard({ report }: { report: Report }) {
  const { product } = report;
  const { positive, neutral, negative } = product.sentiment;
  const total = positive + neutral + negative;
  const quotes = report.answers.flatMap((a) =>
    a.mentions.filter((m) => m.brand === product.brand).map((m) => ({ model: a.model, sentiment: m.sentiment, snippet: m.snippet })),
  );
  const picks = [quotes.find((q) => q.sentiment === "positive"), quotes.find((q) => q.sentiment === "negative")].filter(Boolean) as typeof quotes;
  const rivals = report.brands.filter((b) => !b.isProduct && b.mentions > 0).slice(0, 4);

  return (
    <SectionCard icon={SmileIcon} tint="bg-meadow-100 text-meadow-700" title="Sentiment" description="How warmly you're described when mentioned">
      {total === 0 ? (
        <p className="py-6 text-center text-ink-soft">No mentions yet, so there&apos;s no tone to read.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-heading text-3xl font-semibold text-meadow-700 tabular-nums">{pct(positive / total)}</span>
              <span className="text-sm text-ink-soft">positive mentions</span>
            </div>
            <SentimentBar stats={product} className="h-4" />
            <div className="mt-2 flex gap-4 text-xs font-semibold text-ink-soft">
              <span className="flex items-center gap-1.5"><Dot color="#A6D48B" />{positive} positive</span>
              <span className="flex items-center gap-1.5"><Dot color="#EADFC9" />{neutral} neutral</span>
              <span className="flex items-center gap-1.5"><Dot color="#F4B2A9" />{negative} with caveats</span>
            </div>
          </div>
          {picks.length > 0 && (
            <ul className="space-y-2">
              {picks.map((q) => (
                <li key={q.sentiment} className={cn("flex gap-2.5 rounded-2xl p-3 text-sm", q.sentiment === "positive" ? "bg-meadow-50" : "bg-blush-100/60")}>
                  <ModelBadge model={q.model} className="size-6" />
                  <span className="text-ink">“…{q.snippet.replace(/\*\*/g, "").trim()}…”</span>
                </li>
              ))}
            </ul>
          )}
          {rivals.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold tracking-wide text-ink-soft uppercase">Compared with rivals</p>
              <ul className="space-y-2">
                {rivals.map((b) => (
                  <li key={b.brand} className="flex items-center gap-3 text-sm">
                    <span className="w-24 truncate font-semibold">{b.brand}</span>
                    <SentimentBar stats={b} className="h-2.5" />
                    <span className="w-9 text-right text-xs font-bold tabular-nums">{pct(b.sentiment.positive / Math.max(b.mentions, 1))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
