import { AppShell } from "@/components/layout/app-shell";
import { CreateWithDexter } from "@/components/report-builder/create-with-dexter";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const { user, access, dexterAvatarUrl } = await loadReportsPageContext();
  return (
    <AppShell user={user}>
      {access?.canUse ? (
        <CreateWithDexter canChat={access.canChat} dexterAvatarUrl={dexterAvatarUrl} />
      ) : (
        <ReportsNoAccess />
      )}
    </AppShell>
  );
}
