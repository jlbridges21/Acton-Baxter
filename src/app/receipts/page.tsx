import { AppShell } from "@/components/layout/app-shell";
import { ReceiptLogClient } from "@/components/receipts/receipt-log-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listExpenseJobs, syncExpenseJobsFromMasterProjectLog } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const user = await requireActiveUser();
  await syncExpenseJobsFromMasterProjectLog();
  const jobs = await listExpenseJobs({ includeInactive: false });

  return (
    <AppShell user={user}>
      <ReceiptLogClient initialJobs={jobs} isAdmin={isAdminRole(user.profile.role)} />
    </AppShell>
  );
}
