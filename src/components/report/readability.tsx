"use client";

import {
  AiScanIcon,
  Alert02Icon,
  ArrowDown01Icon,
  Copy01Icon,
  FirewallIcon,
  JavaScriptIcon,
  Note01Icon,
  PlusSignIcon,
  RefreshIcon,
  Robot01Icon,
  Structure03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModelBadge } from "@/components/art/model-badge";
import { Pip } from "@/components/art/pip";
import { Icon } from "@/components/icon";
import type { AuditProgress, SiteAuditView } from "@/components/report/use-site-audit";
import { Meter, SectionCard } from "@/components/report/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { auditBadges, auditHeadline, auditSubline, checkedAgo, pipMood } from "@/lib/audit/summary";
import type { AuditArea, AuditStep, BotResult, Finding, Grade, PageAudit, SiteAudit } from "@/lib/audit/types";
import { MODEL_LABELS } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

const AREAS: Record<AuditArea, { label: string; icon: IconSvgElement; tint: string; color: string }> = {
  access: { label: "Crawler access", icon: Robot01Icon, tint: "bg-sky-100 text-sky-700", color: "#8CC5EC" },
  rendering: { label: "Readable without JavaScript", icon: JavaScriptIcon, tint: "bg-blush-100 text-[#a5463d]", color: "#F2A79C" },
  structure: { label: "Structured data", icon: Structure03Icon, tint: "bg-lavender-100 text-[#5f4bb0]", color: "#B4A3EC" },
  discovery: { label: "Discovery files", icon: Note01Icon, tint: "bg-sun-100 text-[#a86f12]", color: "#FFC56E" },
};

const GRADES: Record<Grade, { ring: string; text: string; tile: string }> = {
  A: { ring: "#6CAF5C", text: "text-meadow-700", tile: "from-meadow-100 to-sky-50 ring-meadow-200/70" },
  B: { ring: "#6CAF5C", text: "text-meadow-700", tile: "from-meadow-100 to-sun-100/70 ring-meadow-200/70" },
  C: { ring: "#FFC56E", text: "text-[#a86f12]", tile: "from-sun-100 to-meadow-50 ring-sun-200/70" },
  D: { ring: "#F2A79C", text: "text-[#a5463d]", tile: "from-blush-100 to-sun-100/70 ring-blush-200/70" },
  F: { ring: "#F2A79C", text: "text-[#a5463d]", tile: "from-blush-100 to-sun-100/70 ring-blush-200/70" },
};

const TONES = { meadow: "meadow", sun: "sun", blush: "blush" } as const;

const STEPS: { step: AuditStep; label: string }[] = [
  { step: "home", label: "Open your homepage" },
  { step: "robots", label: "Read robots.txt" },
  { step: "bots", label: "Knock as each AI crawler" },
  { step: "files", label: "Look for llms.txt and a sitemap" },
  { step: "pages", label: "Read pages without JavaScript" },
  { step: "score", label: "Grade what Pip found" },
];

const FIXES_SHOWN = 4;
const cardShadow = "shadow-[0_8px_22px_-16px_rgb(73_88_120/0.7)] ring-1 ring-border/50";

const pathOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
};

export function ReadabilityCard({ view, onRecheck }: { view: SiteAuditView; onRecheck?: () => void }) {
  return (
    <SectionCard
      id="readability"
      icon={AiScanIcon}
      tint="bg-sun-100 text-[#a86f12]"
      title="AI readability"
      description="Can assistants actually read your site? Pip checked it the way their crawlers do."
      action={<CardAction view={view} onRecheck={onRecheck} />}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view.status}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {view.status === "done" && <AuditResult audit={view.audit} />}
          {view.status === "running" && <Progress site={view.site} progress={view.progress} />}
          {view.status === "failed" && <Failed site={view.site} message={view.message} onRetry={onRecheck} />}
          {view.status === "no-site" && <NoSite />}
        </motion.div>
      </AnimatePresence>
    </SectionCard>
  );
}

function CardAction({ view, onRecheck }: { view: SiteAuditView; onRecheck?: () => void }) {
  if (view.status === "running") {
    return (
      <Badge variant="sky" className="h-6 gap-1.5 px-2.5">
        <span className="size-1.5 animate-pulse rounded-full bg-sky-700" />
        Checking
      </Badge>
    );
  }
  if (view.status !== "done") return null;
  if (view.sample) {
    return (
      <Badge variant="outline" className="h-6 bg-white/70 px-2.5">
        Sample site
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-ink-soft sm:inline">Checked {checkedAgo(view.audit.checkedAt)}</span>
      {onRecheck && (
        <Button size="xs" variant="outline" className="bg-white/70" onClick={onRecheck}>
          <Icon icon={RefreshIcon} />
          Check again
        </Button>
      )}
    </div>
  );
}

function AuditResult({ audit }: { audit: SiteAudit }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-4">
          <ScoreTile audit={audit} />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <AreaTiles audit={audit} />
          <BotMatrix audit={audit} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <PagesList audit={audit} />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <FixList findings={audit.findings} />
        </div>
      </div>
    </div>
  );
}

function GradeRing({ audit }: { audit: SiteAudit }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const style = GRADES[audit.grade];
  return (
    <div className="relative mx-auto size-40" role="img" aria-label={`Grade ${audit.grade}, ${audit.score} out of 100`}>
      <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#F1E7D4" strokeWidth="12" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={style.ring}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - audit.score / 100) }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className={cn("font-heading text-5xl leading-none font-semibold", style.text)}>{audit.grade}</span>
        <span className="mt-1 text-sm font-bold text-ink-soft tabular-nums">{audit.score} / 100</span>
      </div>
      <Pip mood={pipMood(audit)} className="absolute -right-4 -bottom-1 size-14" />
    </div>
  );
}

function ScoreTile({ audit }: { audit: SiteAudit }) {
  const badges = auditBadges(audit);
  return (
    <div className={cn("flex h-full flex-col gap-5 rounded-3xl bg-gradient-to-br p-5 ring-1", GRADES[audit.grade].tile)}>
      <div className="flex flex-1 flex-col justify-center gap-4">
        <GradeRing audit={audit} />
        <div className="text-center">
          <p className="font-heading text-lg leading-snug font-semibold text-balance">{auditHeadline(audit)}</p>
          <p className="mt-1 text-sm text-ink-soft text-pretty">{auditSubline(audit)}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {badges.map((b) => (
            <Badge key={b.label} variant={TONES[b.tone]}>
              {b.label}
            </Badge>
          ))}
        </div>
      </div>
      <SiteFacts audit={audit} />
    </div>
  );
}

function SiteFacts({ audit }: { audit: SiteAudit }) {
  const checked = (area: AuditArea) => audit.areas.find((a) => a.area === area)?.checked ?? false;
  const facts: { label: string; value: string; ok: boolean | null }[] = [
    {
      label: "robots.txt",
      value: audit.robots.state === "found" ? "Found" : audit.robots.state === "missing" ? "None, so all allowed" : "Didn't load",
      ok: audit.robots.state !== "unreachable",
    },
    {
      label: "Sitemap",
      value: !checked("discovery") ? "Not checked" : audit.sitemap.found ? `${audit.sitemap.pages.toLocaleString()} pages` : "Not found",
      ok: checked("discovery") ? audit.sitemap.found : null,
    },
    {
      label: "llms.txt",
      value: !checked("discovery") ? "Not checked" : audit.llmsTxt.found ? `${audit.llmsTxt.links} links` : "Not found",
      ok: checked("discovery") ? audit.llmsTxt.found : null,
    },
    {
      label: "Organization",
      value: !checked("structure") ? "Not checked" : audit.organization ? (audit.organization.name ?? "No name") : "Not found",
      ok: checked("structure") ? Boolean(audit.organization) : null,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-1.5 rounded-2xl bg-white/70 p-2.5">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0 rounded-xl px-2 py-1.5">
          <dt className="text-[0.7rem] font-bold tracking-wide text-ink-soft uppercase">{f.label}</dt>
          <dd className="mt-0.5 flex items-center gap-1 text-sm font-semibold">
            {f.ok !== null && (
              <Icon icon={f.ok ? Tick02Icon : Alert02Icon} className={cn("size-3.5 shrink-0", f.ok ? "text-meadow-600" : "text-[#c0675d]")} strokeWidth={2.4} />
            )}
            <span className={cn("truncate", f.ok === null && "font-normal text-ink-soft")}>{f.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AreaTiles({ audit }: { audit: SiteAudit }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {audit.areas.map((a, i) => {
        const style = AREAS[a.area];
        return (
          <motion.li
            key={a.area}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 260, damping: 24, delay: i * 0.05 }}
            className={cn("rounded-3xl bg-white/80 p-4", cardShadow)}
          >
            <div className="flex items-center gap-2.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", style.tint)}>
                <Icon icon={style.icon} className="size-4" />
              </span>
              <p className="font-heading text-[0.95rem] leading-tight font-semibold">{style.label}</p>
              {a.checked ? (
                <span className="ml-auto font-heading text-lg font-semibold tabular-nums">
                  {a.points}
                  <span className="text-sm font-normal text-ink-soft">/{a.max}</span>
                </span>
              ) : (
                <Badge variant="outline" className="ml-auto bg-white/70">
                  Not checked
                </Badge>
              )}
            </div>
            <Meter value={a.checked ? a.points / a.max : 0} color={style.color} className="mt-3" />
            <p className="mt-2 text-xs text-ink-soft">{a.checked ? a.note : a.note.replace(/^Not checked:\s*/, "")}</p>
          </motion.li>
        );
      })}
    </ul>
  );
}

function access(bot: BotResult, robotsState: SiteAudit["robots"]["state"]): { label: string; className: string; reason?: string; tip: string } {
  const blush = "bg-blush-100 text-[#a5463d]";
  const sun = "bg-sun-100 text-[#8a5a12]";
  switch (bot.access) {
    case "allowed":
      return {
        label: "Gets in",
        className: "bg-meadow-100 text-meadow-700",
        tip: bot.probe?.status ? `robots.txt lets it in and your homepage answered ${bot.probe.status} to its name.` : "robots.txt lets it in.",
      };
    case "partial": {
      const shown = bot.blockedPaths.slice(0, 2).join(", ");
      const more = bot.blockedPaths.length > 2 ? ` and ${bot.blockedPaths.length - 2} more` : "";
      return { label: "Partly blocked", className: sun, reason: `Kept off ${shown}${more}`, tip: bot.note };
    }
    case "robots":
      return {
        label: "Blocked in robots.txt",
        className: bot.role === "training" ? sun : blush,
        reason:
          robotsState === "unreachable"
            ? "robots.txt didn't load, so it stays away"
            : bot.rule
              ? `Line ${bot.rule.line}: ${bot.rule.text.replace(/ /g, "\u00a0")}`
              : "robots.txt keeps it out",
        tip: bot.note,
      };
    case "firewall":
      return {
        label: bot.probe?.challenge ? "Bot check" : `Turned away (${bot.probe?.status ?? "no answer"})`,
        className: blush,
        reason: "robots.txt lets it in, the server doesn't",
        tip: `${bot.note} A browser got in, so this is likely a firewall or CDN rule.`,
      };
    case "unconfirmed":
      return {
        label: "Unconfirmed",
        className: "bg-sky-100 text-sky-700",
        reason: "Refused, but so was Kioku's crawler",
        tip: "Your bot protection refused this name and Kioku's own crawler too. It may still let the real crawler in by its address, so check your firewall settings.",
      };
  }
}

function BotMatrix({ audit }: { audit: SiteAudit }) {
  const models = [...new Set(audit.bots.map((b) => b.model))];
  const subtitle =
    audit.robots.state === "missing"
      ? "No robots.txt, so every crawler may read everything"
      : audit.robots.state === "unreachable"
        ? "robots.txt didn't load, so crawlers stay away"
        : "Your robots.txt rules, plus a real request as each bot";
  return (
    <div className="rounded-3xl bg-sky-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Icon icon={FirewallIcon} className="size-4.5 text-sky-700" />
        <p className="font-heading font-semibold">Who gets in</p>
        <p className={cn("text-xs", audit.robots.state === "unreachable" ? "font-semibold text-[#a5463d]" : "text-ink-soft")}>{subtitle}</p>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {models.map((model) => (
          <li key={model} className="flex items-start gap-3 rounded-2xl bg-white/85 p-3">
            <ModelBadge model={model} className="size-8" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-bold">{MODEL_LABELS[model]}</p>
              {audit.bots
                .filter((b) => b.model === model)
                .map((b) => {
                  const a = access(b, audit.robots.state);
                  return (
                    <div key={b.token} className="flex items-start gap-2 text-sm">
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate font-mono text-[0.8rem] font-semibold">{b.token}</span>
                        <span className="block truncate text-xs text-ink-soft">{b.roleLabel}</span>
                        {a.reason && <span className="mt-0.5 block text-xs break-words text-ink-soft/90 italic">{a.reason}</span>}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn("shrink-0 cursor-help rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50", a.className)}
                          >
                            {a.label}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{a.tip}</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICTS: Partial<Record<PageAudit["verdict"], { label: string; variant: "blush" | "sun" | "outline" }>> = {
  blank: { label: "Blank without JavaScript", variant: "blush" },
  thin: { label: "Thin", variant: "sun" },
  failed: { label: "Couldn't read", variant: "blush" },
  skipped: { label: "Skipped", variant: "outline" },
};
const BAR_COLORS: Record<string, string> = { readable: "#6CAF5C", thin: "#FFC56E", blank: "#F2A79C" };

/** Bars stop growing here, so one very long page doesn't squash the rest. */
const FULL_BAR_WORDS = 2_500;

function PagesList({ audit }: { audit: SiteAudit }) {
  const host = new URL(audit.homepage).host.replace(/^www\./, "");
  const max = Math.min(FULL_BAR_WORDS, Math.max(600, ...audit.pages.map((p) => p.words)));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-heading font-semibold">Pages Pip read</p>
        <p className="text-xs text-ink-soft">Words a crawler sees without running JavaScript</p>
      </div>
      {audit.pages.length === 0 ? (
        <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-ink-soft">Pip didn&apos;t get to read any pages.</p>
      ) : (
        <ol className="space-y-3.5">
          {audit.pages.map((p) => {
            const verdict = VERDICTS[p.verdict];
            const read = p.verdict === "readable" || p.verdict === "thin" || p.verdict === "blank";
            return (
              <li key={p.url} className="text-sm">
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <a href={p.url} target="_blank" rel="noreferrer" title={p.url} className="min-w-0 max-w-full truncate font-mono text-[0.8rem] font-semibold hover:text-sky-700">
                      <span className="text-ink-soft">{host}</span>
                      {pathOf(p.url)}
                    </a>
                    {p.cited > 0 && <Badge variant="meadow">Cited {p.cited}×</Badge>}
                    {verdict && (
                      <Badge variant={verdict.variant} className={verdict.variant === "outline" ? "bg-white/70" : undefined}>
                        {verdict.label}
                      </Badge>
                    )}
                    {p.noindex && <Badge variant="sun">noindex</Badge>}
                  </div>
                  {read && <SchemaBadges types={p.schemaTypes} />}
                </div>
                {read ? (
                  <>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter value={Math.min(1, p.words / max)} color={BAR_COLORS[p.verdict]} className="h-2" />
                      <span className="w-20 text-right text-xs text-ink-soft tabular-nums">{p.words.toLocaleString()} words</span>
                    </div>
                    {p.appShell && <p className="mt-1 text-xs text-ink-soft">{p.appShell}</p>}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-ink-soft">{p.note}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const SCHEMA_SHOWN = 2;

function SchemaBadges({ types }: { types: string[] }) {
  if (types.length === 0) {
    return (
      <Badge variant="outline" className="shrink-0 bg-white/70 text-ink-soft">
        No schema
      </Badge>
    );
  }
  const more = types.length - SCHEMA_SHOWN;
  return (
    <span className="flex shrink-0 gap-1">
      {types.slice(0, SCHEMA_SHOWN).map((s) => (
        <Badge key={s} variant="lavender">
          {s}
        </Badge>
      ))}
      {more > 0 && (
        <Badge variant="lavender" title={types.slice(SCHEMA_SHOWN).join(", ")}>
          +{more}
        </Badge>
      )}
    </span>
  );
}

function priorityOf(f: Finding): { label: string; variant: "blush" | "sun" | "sky" } {
  if (f.severity === "fail") return { label: "Do first", variant: "blush" };
  return f.impact >= 5 ? { label: "Next up", variant: "sun" } : { label: "Keep in mind", variant: "sky" };
}

function FixList({ findings }: { findings: Finding[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? findings : findings.slice(0, FIXES_SHOWN);
  return (
    <div>
      <p className="mb-3 font-heading font-semibold">Fix these first</p>
      {findings.length === 0 ? (
        <div className="flex items-center gap-3 rounded-3xl bg-meadow-50 p-4 ring-1 ring-meadow-200/70">
          <Pip mood="happy" className="size-12 shrink-0" />
          <p className="text-sm text-ink-soft">Nothing to fix. AI crawlers can read everything Pip checked.</p>
        </div>
      ) : (
        <>
          <ol className="space-y-3">
            {shown.map((f, i) => {
              const priority = priorityOf(f);
              const area = AREAS[f.area];
              return (
                <motion.li
                  key={f.id}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: Math.min(i, FIXES_SHOWN) * 0.04 }}
                  className={cn("rounded-3xl bg-white/80 p-4", cardShadow)}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("flex size-7 items-center justify-center rounded-lg", area.tint)}>
                      <Icon icon={area.icon} className="size-3.5" />
                    </span>
                    <Badge variant={priority.variant}>{priority.label}</Badge>
                  </div>
                  <p className="mt-2 font-heading leading-snug font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{f.detail}</p>
                  {f.snippet && <Snippet label={f.snippet.label} text={f.snippet.text} />}
                </motion.li>
              );
            })}
          </ol>
          {findings.length > FIXES_SHOWN && (
            <Button variant="ghost" size="sm" className="mt-2 w-full text-ink-soft" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? "Show fewer" : `Show all ${findings.length} fixes`}
              <Icon icon={ArrowDown01Icon} className={cn("transition-transform", all && "rotate-180")} />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy that. Select the text and copy it instead.");
    }
  };
  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-cream-deep/70 ring-1 ring-sun-200/60">
      <pre className="max-h-56 overflow-auto px-3 py-2.5 font-mono text-[0.72rem] leading-relaxed text-ink">{text}</pre>
      <div className="flex justify-end border-t border-sun-200/60 px-2 py-1.5">
        <Button size="xs" variant="outline" onClick={copy} aria-live="polite">
          <Icon icon={copied ? Tick02Icon : Copy01Icon} />
          {copied ? "Copied" : label}
        </Button>
      </div>
    </div>
  );
}

function Progress({ site, progress }: { site: string; progress: AuditProgress }) {
  const current = Math.max(0, STEPS.findIndex((s) => s.step === progress.step));
  const pageShare = progress.step === "pages" && progress.total ? progress.done / progress.total : 0;
  const share = (current + pageShare + 0.35) / STEPS.length;
  return (
    <div className="grid gap-4 rounded-3xl bg-gradient-to-br from-sun-100 to-meadow-50 p-5 ring-1 ring-sun-200/70 md:grid-cols-2 md:p-6" aria-live="polite" aria-busy="true">
      <div className="flex flex-col justify-center gap-4">
        <div className="flex items-center gap-4">
          <Pip mood="thinking" className="size-16 shrink-0" />
          <div className="min-w-0">
            <p className="shimmer-text font-heading text-xl font-semibold">Reading {site}…</p>
            <p className="text-sm text-ink-soft">The way AI crawlers do: plain HTML, no JavaScript</p>
          </div>
        </div>
        <div>
          <span className="block h-2.5 overflow-hidden rounded-full bg-white/80">
            <motion.span className="block h-full rounded-full bg-meadow-500" initial={false} animate={{ width: `${Math.min(1, share) * 100}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
          </span>
          <p className="mt-2 text-xs text-ink-soft">
            {progress.message}
            {progress.step === "pages" && progress.total > 0 && ` · ${progress.done} of ${progress.total} pages`}
          </p>
        </div>
      </div>
      <ol className="space-y-1.5 rounded-2xl bg-white/70 p-3">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <li key={s.step} className={cn("flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm", state === "now" && "bg-white font-semibold shadow-[0_2px_8px_-4px_rgb(73_88_120/0.4)]")}>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  state === "done" ? "bg-meadow-500 text-white" : state === "now" ? "bg-sun-200" : "bg-[#F1E7D4]",
                )}
              >
                {state === "done" ? <Icon icon={Tick02Icon} className="size-3" strokeWidth={3} /> : state === "now" ? <span className="size-2 animate-pulse rounded-full bg-[#a86f12]" /> : null}
              </span>
              <span className={cn(state === "next" && "text-ink-soft")}>{s.label}</span>
              {s.step === "pages" && state === "now" && progress.total > 0 && (
                <span className="ml-auto text-xs text-ink-soft tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Failed({ site, message, onRetry }: { site: string; message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-blush-100/50 px-5 py-8 text-center ring-1 ring-blush-200/70">
      <Pip mood="idle" className="size-16" />
      <div className="max-w-lg">
        <p className="font-heading text-lg font-semibold">The audit of {site} didn&apos;t finish</p>
        <p className="mt-1 text-sm text-ink-soft text-pretty">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" className="bg-white/80" onClick={onRetry}>
          <Icon icon={RefreshIcon} />
          Try again
        </Button>
      )}
    </div>
  );
}

function NoSite() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-sky-50/80 px-5 py-8 text-center ring-1 ring-sky-200/60">
      <Pip mood="wave" className="size-16" />
      <div className="max-w-lg">
        <p className="font-heading text-lg font-semibold">Pip needs your website for this</p>
        <p className="mt-1 text-sm text-ink-soft text-pretty">
          This check didn&apos;t include a website. Add yours when you start a check and Pip will read it the way AI crawlers do: robots.txt, bot access,
          structured data and pages without JavaScript.
        </p>
      </div>
      <Button variant="outline" className="bg-white/80" asChild>
        <Link href="/">
          <Icon icon={PlusSignIcon} strokeWidth={2.4} />
          Start a new check
        </Link>
      </Button>
    </div>
  );
}
