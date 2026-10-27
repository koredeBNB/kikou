"use client";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { ModelBadge } from "@/components/art/model-badge";
import { Meter, SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { pct } from "@/lib/format";
import { ownDomains } from "@/lib/sov/citations";
import type { Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

const BUBBLES = ["bg-sky-100 text-sky-700", "bg-sun-100 text-[#a86f12]", "bg-lavender-100 text-[#5f4bb0]", "bg-blush-100 text-[#a5463d]", "bg-meadow-100 text-meadow-700"];

export function SourcesCard({ report }: { report: Report }) {
  const top = report.domains.slice(0, 10);
  const own = report.domains.filter((d) => d.isOwn).reduce((s, d) => s + d.count, 0);
  const competitor = report.domains.filter((d) => d.isCompetitor).reduce((s, d) => s + d.count, 0);
  const max = Math.max(...top.map((d) => d.count), 1);
  const sites = ownDomains(report.brief).length;
  const stats = [
    { label: "Citations", value: report.totalCitations },
    { label: "Domains", value: report.domains.length },
    { label: sites ? `From your site${sites > 1 ? "s" : ""}` : "Add your site", value: sites ? own : "—" },
    { label: "From rivals' sites", value: competitor },
  ];

  return (
    <SectionCard
      id="sources"
      icon={Globe02Icon}
      tint="bg-sky-100 text-sky-700"
      title="Cited sources"
      description="The sites assistants lean on when they answer. Getting featured here moves the needle."
    >
      <dl className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-sky-50 px-3 py-2.5 text-center">
            <dd className="font-heading text-2xl font-semibold text-sky-700 tabular-nums">{s.value}</dd>
            <dt className="text-xs font-semibold text-ink-soft">{s.label}</dt>
          </div>
        ))}
      </dl>
      {top.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">
          No sources were cited. Assistants only cite links when they search the web, so turn on web search for live checks.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {top.map((d, i) => (
            <li key={d.domain} className="flex items-center gap-3 text-sm">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl font-heading font-semibold uppercase", d.isOwn ? "bg-meadow-200 text-meadow-700" : BUBBLES[i % BUBBLES.length])}>
                {d.domain[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a href={d.urls[0]} target="_blank" rel="noreferrer" className="truncate font-semibold hover:text-sky-700">
                    {d.domain}
                  </a>
                  {d.isOwn && <Badge variant="meadow">Your site</Badge>}
                  {d.isCompetitor && <Badge variant="blush">Rival site</Badge>}
                  <span className="ml-auto flex -space-x-1.5">
                    {d.models.map((m) => (
                      <ModelBadge key={m} model={m} className="size-5 ring-2 ring-white" />
                    ))}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Meter value={d.count / max} color={d.isOwn ? "#6CAF5C" : "#8CC5EC"} className="h-2" />
                  <span className="w-16 text-right text-xs text-ink-soft tabular-nums">
                    {d.count}× · {pct(d.share)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
