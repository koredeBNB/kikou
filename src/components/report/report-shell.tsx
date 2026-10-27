"use client";

import {
  AiChat02Icon,
  AiScanIcon,
  BubbleChatQuestionIcon,
  DashboardSquare01Icon,
  Globe02Icon,
  Idea01Icon,
  InformationCircleIcon,
  Layers01Icon,
  Menu01Icon,
  PieChartIcon,
  PlusSignIcon,
  RankingIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pip } from "@/components/art/pip";
import { SkyScene } from "@/components/art/sky-scene";
import { BrandMark } from "@/components/brand-mark";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DEMO_RUN_ID } from "@/lib/sov/demo";
import { INDEX_KEY } from "@/lib/sov/storage";
import { cn } from "@/lib/utils";

type NavItem = { id: string; label: string; icon: IconSvgElement };

const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: DashboardSquare01Icon },
  { id: "share-of-voice", label: "Share of voice", icon: PieChartIcon },
  { id: "topics", label: "Topics", icon: Layers01Icon },
  { id: "recommendations", label: "Next steps", icon: Idea01Icon },
  { id: "rankings", label: "Leaderboard", icon: RankingIcon },
  { id: "assistants", label: "Assistants", icon: AiChat02Icon },
  { id: "sources", label: "Sources", icon: Globe02Icon },
  { id: "readability", label: "AI readability", icon: AiScanIcon },
  { id: "prompts", label: "Prompts", icon: BubbleChatQuestionIcon },
  { id: "method", label: "How it works", icon: InformationCircleIcon },
];

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

function useRecentRuns() {
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(INDEX_KEY),
    () => null,
  );
  return useMemo(() => {
    try {
      return (JSON.parse(raw ?? "[]") as { id: string; product: string; createdAt: string }[]).slice(0, 5);
    } catch {
      return [];
    }
  }, [raw]);
}

function useActiveSection(enabled: boolean, nav: NavItem[]) {
  const [active, setActive] = useState(nav[0].id);
  useEffect(() => {
    if (!enabled) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const best = nav.map((n) => n.id).find((id) => (visible.get(id) ?? 0) > 0);
        if (best) setActive(best);
      },
      { rootMargin: "-90px 0px -55% 0px", threshold: [0, 0.01, 0.25] },
    );
    for (const n of nav) {
      const el = document.getElementById(n.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled, nav]);
  return active;
}

function NavList({ nav, active, onNavigate }: { nav: NavItem[]; active: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Report sections">
      <ul className="space-y-1">
        {nav.map((n) => (
          <li key={n.id}>
            <a
              href={`#${n.id}`}
              onClick={onNavigate}
              aria-current={active === n.id ? "true" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-ink-soft transition",
                active === n.id ? "bg-meadow-100 text-meadow-700 shadow-[inset_0_0_0_1px_rgb(166_212_139/0.6)]" : "hover:bg-white/80 hover:text-ink",
              )}
            >
              <Icon icon={n.icon} className="size-[1.15rem]" />
              {n.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RecentRuns({ currentId, onNavigate }: { currentId: string; onNavigate?: () => void }) {
  const runs = useRecentRuns();
  const items = [...runs.map((r) => ({ id: r.id, label: r.product })), { id: DEMO_RUN_ID, label: "Sample report" }];
  return (
    <div>
      <p className="mb-1.5 px-3 text-xs font-bold tracking-wide text-ink-soft uppercase">Your checks</p>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={`/report/${r.id}`}
              onClick={onNavigate}
              className={cn(
                "block truncate rounded-xl px-3 py-1.5 text-sm transition",
                r.id === currentId ? "bg-white font-bold text-ink shadow-[0_2px_8px_-4px_rgb(73_88_120/0.4)]" : "text-ink-soft hover:bg-white/70 hover:text-ink",
              )}
            >
              {r.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipCard({ tip, onNavigate }: { tip?: string; onNavigate?: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sun-100 to-meadow-50 p-4 ring-1 ring-sun-200/70">
      <Pip mood="happy" className="absolute -right-3 -bottom-3 size-16 opacity-90" />
      <p className="font-heading text-sm font-semibold">Pip&apos;s tip</p>
      <p className="mt-1 pr-12 text-xs leading-relaxed text-ink-soft">
        {tip ?? "Assistants change their minds. Re-run this check after every launch or big piece of press."}
      </p>
      {tip && (
        <a href="#recommendations" onClick={onNavigate} className="mt-2 inline-block text-xs font-bold text-meadow-700 hover:underline">
          See how
        </a>
      )}
    </div>
  );
}

export function ReportShell({
  runId,
  tip,
  ready,
  topics = false,
  children,
}: {
  runId: string;
  tip?: string;
  ready: boolean;
  topics?: boolean;
  children: ReactNode;
}) {
  const nav = useMemo(() => (topics ? NAV : NAV.filter((n) => n.id !== "topics")), [topics]);
  const active = useActiveSection(ready, nav);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-h-dvh">
      <SkyScene variant="calm" />
      <aside className="no-print fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-6 border-r border-white/60 bg-[#FFFCF4]/75 px-4 py-5 backdrop-blur-xl lg:flex">
        <BrandMark className="px-2" />
        <Button asChild className="w-full">
          <Link href="/">
            <Icon icon={PlusSignIcon} strokeWidth={2.4} />
            New check
          </Link>
        </Button>
        <NavList nav={nav} active={active} />
        <div className="mt-auto space-y-5">
          <RecentRuns currentId={runId} />
          <TipCard tip={tip} />
        </div>
      </aside>

      <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/60 bg-[#FFFCF4]/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <BrandMark />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open report menu">
              <Icon icon={Menu01Icon} className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-6 overflow-y-auto bg-[#FFFCF4] px-4 py-5">
            <SheetTitle className="sr-only">Report menu</SheetTitle>
            <BrandMark className="px-2" />
            <NavList nav={nav} active={active} onNavigate={() => setOpen(false)} />
            <RecentRuns currentId={runId} onNavigate={() => setOpen(false)} />
            <TipCard tip={tip} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>

      <div className="relative lg:pl-64">{children}</div>
    </div>
  );
}
