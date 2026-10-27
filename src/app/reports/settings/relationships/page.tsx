import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { RelationshipsAdmin } from "@/components/report-builder/relationships-admin";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function ReportsRelationshipsPage() {
  const { user, access } = await loadReportsPageContext();
  if (!access?.isAdmin) redirect("/reports");
  return (
    <AppShell user={user}>
      <RelationshipsAdmin />
    </AppShell>
  );
}
