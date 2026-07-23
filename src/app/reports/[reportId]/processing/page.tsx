import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ProcessingClient } from "@/components/reports/processing-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

type PageProps = {
  params: Promise<{ reportId: string }>;
};

export default async function ProcessingPage({ params }: PageProps) {
  const user = await requireActiveUser();
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();

  const report = await getReportStore().getReport(reportId);
  if (!report) notFound();
  if (report.status === "complete") {
    redirect(`/reports/${reportId}`);
  }

  return (
    <AppShell user={user}>
      <ProcessingClient reportId={reportId} />
    </AppShell>
  );
}
