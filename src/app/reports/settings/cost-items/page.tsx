import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CostItemsAdmin } from "@/components/report-builder/cost-items-admin";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function ReportsCostItemsPage() {
  const { user, access } = await loadReportsPageContext();
  if (!access?.isAdmin) redirect("/reports");
  return (
    <AppShell user={user}>
      <CostItemsAdmin />
    </AppShell>
  );
}
