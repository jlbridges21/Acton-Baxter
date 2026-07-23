import { AppShell } from "@/components/layout/app-shell";
import { NewReportForm } from "@/components/reports/new-report-form";
import { requireUser } from "@/lib/auth/session";

export default async function NewReportPage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">New property research</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Enter a property address to research public property, parcel, zoning, and planning
          information.
        </p>
      </div>
      <NewReportForm />
    </AppShell>
  );
}
