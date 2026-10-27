import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { BriefDraft } from "@/lib/intake/brief";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <dt className="pt-0.5 text-xs font-bold tracking-wide text-ink-soft/80 uppercase">{label}</dt>
      <dd className="min-w-0 text-[0.95rem]">{children}</dd>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <span className="text-ink-soft">{children}</span>;

/** The brief Pip drafted, for the user to confirm or correct. */
export function BriefCard({ brief }: { brief: BriefDraft }) {
  const topics = brief.topics ?? [];
  return (
    <div className="space-y-3">
      <div>
        <p className="font-heading text-lg font-semibold text-meadow-700">{brief.product}</p>
        {brief.description && <p className="text-sm text-ink-soft">{brief.description}</p>}
      </div>
      <dl className="space-y-2.5 rounded-2xl bg-sky-50/80 px-3.5 py-3">
        <Row label="Category">
          <Badge variant="sky" className="h-6 px-2.5 text-sm">
            {brief.category}
          </Badge>
        </Row>
        <Row label="For">{brief.audience || <Empty>Everyone</Empty>}</Row>
        <Row label="Website">{brief.website || <Empty>None</Empty>}</Row>
        <Row label="Focus areas">
          {topics.length ? (
            <span className="flex flex-wrap gap-1.5">
              {topics.map((t) => (
                <Badge key={t} variant="outline" className="h-6 border-sun-200 bg-sun-100 px-2.5 text-sm text-[#8a5f12]">
                  {t}
                </Badge>
              ))}
            </span>
          ) : (
            <Empty>A broad check across the category</Empty>
          )}
        </Row>
        <Row label="Rivals">
          {brief.competitors.length ? (
            <span className="flex flex-wrap gap-1.5">
              {brief.competitors.map((c) => (
                <Badge key={c} variant="outline" className="h-6 bg-white px-2.5 text-sm">
                  {c}
                </Badge>
              ))}
            </span>
          ) : (
            <Empty>I&apos;ll spot them in the answers</Empty>
          )}
        </Row>
      </dl>
    </div>
  );
}
