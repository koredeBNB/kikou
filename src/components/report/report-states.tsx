import { ArrowRight01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Pip } from "@/components/art/pip";
import { SkyScene } from "@/components/art/sky-scene";
import { BrandMark } from "@/components/brand-mark";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ReportLoading() {
  return (
    <div className="relative min-h-dvh" aria-busy="true" aria-label="Loading report">
      <SkyScene variant="calm" />
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/60 bg-[#FFFCF4]/75 px-4 py-5 lg:block">
        <BrandMark className="px-2" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-9 rounded-2xl bg-white/70" />
          ))}
        </div>
      </div>
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:pl-[calc(16rem+2rem)]">
        <div className="flex items-center gap-4">
          <Pip mood="thinking" className="size-16" />
          <div>
            <p className="shimmer-text font-heading text-xl font-semibold">Unfolding your report…</p>
            <p className="text-sm text-ink-soft">Counting mentions and sorting sources</p>
          </div>
        </div>
        <Skeleton className="h-28 rounded-[1.75rem] bg-sun-100/70" />
        <div className="grid gap-5 xl:grid-cols-12">
          <Skeleton className="h-96 rounded-[1.75rem] bg-white/70 xl:col-span-3" />
          <Skeleton className="h-96 rounded-[1.75rem] bg-white/70 xl:col-span-6" />
          <Skeleton className="h-96 rounded-[1.75rem] bg-white/70 xl:col-span-3" />
        </div>
      </main>
    </div>
  );
}

export function ReportNotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <SkyScene variant="calm" />
      <header className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <BrandMark />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
        <div className="pillow w-full rounded-[2rem] px-6 py-10">
          <Pip mood="idle" className="mx-auto size-24 animate-bob" />
          <h1 className="mt-4 text-3xl font-semibold">Pip can&apos;t find that report</h1>
          <p className="mt-2 text-ink-soft">
            Reports are kept in this browser only, so they won&apos;t show up on another device or after clearing site data.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/">
                <Icon icon={PlusSignIcon} strokeWidth={2.4} />
                Start a new check
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/report/demo">
                See the sample report
                <Icon icon={ArrowRight01Icon} strokeWidth={2.4} />
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
