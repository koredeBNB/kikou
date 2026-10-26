"use client";

import { Layers01Icon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { Dot, Meter, PRODUCT_COLOR, SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { pct, rankLabel } from "@/lib/format";
import type { TopicStats } from "@/lib/sov/topics";
import { cn } from "@/lib/utils";

const PRIORITY = {
  high: { label: "Do first", variant: "blush" },
  medium: { label: "Next up", variant: "sun" },
  low: { label: "Keep in mind", variant: "sky" },
} as const;

function summary(product: string, topics: TopicStats[]): string {
  const ranked = [...topics].sort((a, b) => b.shareOfVoice - a.shareOfVoice);
  const best = ranked[0];
  const worst = ranked.at(-1)!;
  if (topics.length === 1 || best.shareOfVoice === worst.shareOfVoice) {
    return `How ${product} does in each area you asked about.`;
  }
  return `${product} is strongest on ${best.topic} (${pct(best.shareOfVoice)} share of voice) and weakest on ${worst.topic} (${pct(worst.shareOfVoice)}).`;
}

export function TopicsCard({ product, topics, colors }: { product: string; topics: TopicStats[]; colors: Map<string, string> }) {
  return (
    <SectionCard
      id="topics"
      icon={Layers01Icon}
      tint="bg-sun-100 text-[#a86f12]"
      title="By topic"
      description={summary(product, topics)}
    >
      <ul className={cn("grid gap-3", topics.length > 1 && "md:grid-cols-2", topics.length > 2 && "xl:grid-cols-3")}>
        {topics.map((t, i) => (
          <motion.li
            key={t.topic}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 260, damping: 24, delay: i * 0.05 }}
            className="flex flex-col gap-3.5 rounded-3xl bg-white/80 p-4 shadow-[0_8px_22px_-16px_rgb(73_88_120/0.7)] ring-1 ring-border/50"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate font-heading text-lg font-semibold capitalize">{t.topic}</p>
              <p className="shrink-0 text-xs font-semibold text-ink-soft">
                {t.questions} question{t.questions === 1 ? "" : "s"} · {t.answers} answers
              </p>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-3xl font-semibold text-meadow-700 tabular-nums">{pct(t.shareOfVoice)}</span>
                <span className="text-sm text-ink-soft">share of voice</span>
              </div>
              <Meter value={t.shareOfVoice} color={PRODUCT_COLOR} className="mt-1.5 h-2" />
              <p className="mt-1.5 text-sm text-ink-soft">
                {t.position === null ? (
                  <span className="font-semibold text-[#a5463d]">No assistant named {product} here.</span>
                ) : (
                  <>
                    <span className="font-semibold text-ink">
                      Ranked {rankLabel(t.position)} of {t.brandsRanked}
                    </span>{" "}
                    · named in {pct(t.mentionRate)} of answers{t.avgRank !== null && <>, avg. position {rankLabel(t.avgRank)}</>}
                  </>
                )}
              </p>
            </div>

            {t.leaders.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold tracking-wide text-ink-soft uppercase">Most recommended</p>
                <ol className="space-y-1">
                  {t.leaders.map((l) => (
                    <li key={l.brand} className="flex items-center gap-2 text-sm">
                      <Dot color={colors.get(l.brand) ?? "#ccc"} />
                      <span className={cn("min-w-0 flex-1 truncate", l.isProduct && "font-semibold text-meadow-700")}>{l.brand}</span>
                      <span className="font-semibold tabular-nums">{pct(l.shareOfVoice)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-bold tracking-wide text-ink-soft uppercase">Cited sources</p>
              {t.topDomains.length === 0 ? (
                <p className="text-sm text-ink-soft">No links cited for this topic.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {t.topDomains.map((d) => (
                    <Badge key={d.domain} variant={d.isOwn ? "meadow" : "outline"} className="bg-white/70">
                      {d.domain}
                      <span className="text-ink-soft">×{d.count}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {t.improvements.length > 0 && (
              <div className="mt-auto space-y-2 border-t border-border/50 pt-3">
                {t.improvements.map((r) => (
                  <div key={r.id}>
                    <div className="flex items-start gap-2">
                      <Badge variant={PRIORITY[r.priority].variant} className="mt-px shrink-0">
                        {PRIORITY[r.priority].label}
                      </Badge>
                      <p className="min-w-0 text-sm leading-snug font-semibold">{r.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{r.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.li>
        ))}
      </ul>
    </SectionCard>
  );
}
