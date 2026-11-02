import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FinancialSettings } from "@/components/report-builder/financial-settings";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function ReportsFinancialSettingsPage() {
  const { user, access } = await loadReportsPageContext();
  if (!access?.isAdmin) redirect("/reports");
  return (
    <AppShell user={user}>
      <FinancialSettings />
    </AppShell>
  );
}
