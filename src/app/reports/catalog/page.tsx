import { AppShell } from "@/components/layout/app-shell";
import { DataCatalog } from "@/components/report-builder/data-catalog";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function DataCatalogPage() {
  const { user, access } = await loadReportsPageContext();
  return <AppShell user={user}>{access?.canUse ? <DataCatalog /> : <ReportsNoAccess />}</AppShell>;
}
