"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AuditInput } from "@/lib/audit/audit";
import { buildDemoAudit } from "@/lib/audit/demo";
import { auditInputFor, requestAudit } from "@/lib/audit/request";
import type { AuditStep, SiteAudit } from "@/lib/audit/types";
import { DEMO_RUN_ID } from "@/lib/sov/demo";
import { loadRun, updateRun, type StoredRun } from "@/lib/sov/storage";
import type { Report } from "@/lib/sov/types";

export interface AuditProgress {
  step: AuditStep;
  message: string;
  done: number;
  total: number;
}

type Job =
  | { status: "running"; progress: AuditProgress; previous?: SiteAudit }
  | { status: "failed"; message: string; code?: string; previous?: SiteAudit }
  | { status: "done"; audit: SiteAudit };

export type SiteAuditView =
  | { status: "no-site" }
  | { status: "running"; site: string; progress: AuditProgress }
  | { status: "failed"; site: string; message: string; code?: string }
  | { status: "done"; audit: SiteAudit; sample: boolean };

/** Audits keep running when the report unmounts, and one starts at most once per run in this tab. */
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();

function setJob(id: string, job: Job) {
  jobs.set(id, job);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const starting = (site: string): AuditProgress => ({ step: "home", message: `Opening ${site}`, done: 0, total: 0 });

function startAudit(run: StoredRun, input: AuditInput, previous: SiteAudit | undefined) {
  if (jobs.get(run.id)?.status === "running") return;
  let progress = starting(input.site);
  setJob(run.id, { status: "running", progress, previous });
  void requestAudit(input, (event) => {
    if (event.type === "step") progress = { ...progress, step: event.step, message: event.message };
    else if (event.type === "page") progress = { ...progress, done: event.done, total: event.total };
    setJob(run.id, { status: "running", progress, previous });
  }).then((result) => {
    if (result.ok) {
      // Another write (the brand review) may have landed since this report loaded the run.
      updateRun({ ...(loadRun(run.id) ?? run), audit: result.audit });
      setJob(run.id, { status: "done", audit: result.audit });
      return;
    }
    setJob(run.id, { status: "failed", message: result.message, code: result.code, previous });
    if (previous) toast.error(`Pip couldn't check ${input.site} again`, { description: result.message });
  });
}

/** The report's site audit: the saved one, a fresh one for reports that don't have it yet, or the sample's. */
export function useSiteAudit(run: StoredRun, report: Report): { view: SiteAuditView; audit?: SiteAudit; recheck?: () => void } {
  const sample = run.id === DEMO_RUN_ID;
  const input = useMemo(() => auditInputFor(run.brief, report.answers), [run.brief, report.answers]);
  const sampleAudit = useMemo(() => (sample && input ? buildDemoAudit(input.cited, new Date(run.createdAt)) : undefined), [sample, input, run.createdAt]);
  const job = useSyncExternalStore(
    subscribe,
    () => jobs.get(run.id),
    () => undefined,
  );
  const saved = run.audit?.version === 1 ? run.audit : undefined;
  const needed = !sample && input !== null && !saved;

  useEffect(() => {
    if (needed && input && !jobs.has(run.id)) startAudit(run, input, undefined);
  }, [needed, input, run]);

  const latest = job?.status === "done" ? job.audit : (job?.previous ?? saved);
  const recheck = useCallback(() => {
    if (input) startAudit(run, input, latest);
  }, [input, run, latest]);

  if (sampleAudit) return { view: { status: "done", audit: sampleAudit, sample: true }, audit: sampleAudit };
  if (!input) return { view: { status: "no-site" } };
  if (job?.status === "running") return { view: { status: "running", site: input.site, progress: job.progress }, audit: latest };
  if (latest) return { view: { status: "done", audit: latest, sample: false }, audit: latest, recheck };
  if (job?.status === "failed") return { view: { status: "failed", site: input.site, message: job.message, code: job.code }, recheck };
  return { view: { status: "running", site: input.site, progress: starting(input.site) } };
}
