import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportLoading } from "@/components/report/report-states";
import { ReportView } from "@/components/report/report-view";

export const metadata: Metadata = {
  title: "Share-of-voice report",
};

export default function ReportPage({ params }: PageProps<"/report/[id]">) {
  return (
    <Suspense fallback={<ReportLoading />}>
      <ReportRoute params={params} />
    </Suspense>
  );
}

async function ReportRoute({ params }: Pick<PageProps<"/report/[id]">, "params">) {
  const { id } = await params;
  return <ReportView id={id} />;
}
