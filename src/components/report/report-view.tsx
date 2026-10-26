"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AnswerDialog } from "@/components/answer/answer-dialog";
import { GapsCard, LeaderboardCard, RecommendationsCard, SentimentCard } from "@/components/report/insights";
import { Methodology } from "@/components/report/methodology";
import { ModelBreakdown } from "@/components/report/models";
import { AssistantsGlance, KpiStack, ReportHeader, ShareOfVoiceCard, VerdictBanner } from "@/components/report/overview";
import { PromptsCard } from "@/components/report/prompts";
import { ReportShell } from "@/components/report/report-shell";
import { ReportLoading, ReportNotFound } from "@/components/report/report-states";
import { brandColors, Reveal } from "@/components/report/shared";
import { SourcesCard } from "@/components/report/sources";
import { buildDemoRun, DEMO_RUN_ID } from "@/lib/sov/demo";
import { buildReport } from "@/lib/sov/report";
import { runKey, type StoredRun } from "@/lib/sov/storage";
import type { AnalyzedAnswer } from "@/lib/sov/types";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

function useStoredRun(id: string): StoredRun | null | undefined {
  const demo = id === DEMO_RUN_ID;
  const raw = useSyncExternalStore(
    subscribe,
    () => (demo ? DEMO_RUN_ID : localStorage.getItem(runKey(id))),
    () => undefined,
  );
  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (demo) return buildDemoRun();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredRun;
    } catch {
      return null;
    }
  }, [raw, demo]);
}

export function ReportView({ id }: { id: string }) {
  const run = useStoredRun(id);
  if (run === undefined) return <ReportLoading />;
  if (run === null) return <ReportNotFound />;
  return <Dashboard run={run} />;
}

function Dashboard({ run }: { run: StoredRun }) {
  const report = useMemo(() => buildReport({ brief: run.brief, questions: run.questions, answers: run.answers }), [run]);
  const colors = useMemo(() => brandColors(report), [report]);
  const [open, setOpen] = useState<AnalyzedAnswer | null>(null);
  const question = open ? report.questions.find((q) => q.id === open.questionId) : undefined;
  const rank = open ? (report.prompts.find((p) => p.question.id === open.questionId)?.cells[open.model]?.rank ?? null) : undefined;

  return (
    <ReportShell runId={run.id} tip={report.recommendations[0]?.title} ready>
      <main className="mx-auto max-w-[88rem] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <ReportHeader run={run} report={report} />
        <VerdictBanner run={run} report={report} />

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-12">
          <Reveal className="xl:col-span-3">
            <KpiStack report={report} />
          </Reveal>
          <Reveal className="order-first md:col-span-2 xl:order-none xl:col-span-6" delay={0.05}>
            <ShareOfVoiceCard report={report} colors={colors} />
          </Reveal>
          <Reveal className="xl:col-span-3" delay={0.1}>
            <AssistantsGlance report={report} />
          </Reveal>
        </div>

        <Reveal>
          <RecommendationsCard report={report} />
        </Reveal>

        <div className="grid gap-5 xl:grid-cols-12">
          <Reveal className="xl:col-span-7">
            <LeaderboardCard report={report} colors={colors} />
          </Reveal>
          <Reveal className="xl:col-span-5" delay={0.05}>
            <GapsCard report={report} colors={colors} />
          </Reveal>
        </div>

        <ModelBreakdown report={report} statuses={run.models} />

        <div className="grid gap-5 xl:grid-cols-12">
          <Reveal className="xl:col-span-7">
            <SourcesCard report={report} />
          </Reveal>
          <Reveal className="xl:col-span-5" delay={0.05}>
            <SentimentCard report={report} />
          </Reveal>
        </div>

        <Reveal>
          <PromptsCard report={report} onOpenAnswer={setOpen} />
        </Reveal>

        <Reveal>
          <Methodology />
        </Reveal>

        <p className="pb-4 text-center text-sm text-ink-soft">
          Assistants answer a little differently each time. Treat one check as a snapshot and re-run it to see trends.
        </p>
      </main>

      <AnswerDialog
        answer={open}
        questionText={question?.text ?? ""}
        product={report.brief.product}
        rivals={report.brands.filter((b) => !b.isProduct).map((b) => b.brand)}
        rank={rank}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </ReportShell>
  );
}
