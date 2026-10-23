import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DataSettings } from "@/components/report-builder/data-settings";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function ReportsDataSettingsPage() {
  const { user, access } = await loadReportsPageContext();
  if (!access?.isAdmin) redirect("/reports");
  return (
    <AppShell user={user}>
      <DataSettings />
    </AppShell>
  );
}
