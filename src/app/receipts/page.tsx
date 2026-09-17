import { AppShell } from "@/components/layout/app-shell";
import { ReceiptLogClient } from "@/components/receipts/receipt-log-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listExpenseJobs } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * Fast path: auth + Postgres expense_jobs only.
 * Master Project Log sync is manual (/admin/expense-jobs) or after Project Setup —
 * never on this render path.
 */
export default async function ReceiptsPage() {
  const user = await requireActiveUser();
  const jobs = await listExpenseJobs({ includeInactive: false });

  return (
    <AppShell user={user}>
      <ReceiptLogClient initialJobs={jobs} isAdmin={isAdminRole(user.profile.role)} />
    </AppShell>
  );
}
