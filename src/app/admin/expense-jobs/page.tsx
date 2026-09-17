import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ExpenseJobsAdminClient } from "@/components/admin/expense-jobs-admin-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listExpenseJobs, syncExpenseJobsFromMasterProjectLog } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export default async function AdminExpenseJobsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  await syncExpenseJobsFromMasterProjectLog({ updatedBy: user.id });
  const jobs = await listExpenseJobs({ includeInactive: true });

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <Link href="/" className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]">
          ← Back to Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Expense jobs</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Jobs employees can pick when logging a receipt. Project rows sync from the Master Project
          Log; custom rows are admin-managed. Hide and reorder are preserved across syncs.
        </p>
      </div>
      <ExpenseJobsAdminClient initialJobs={jobs} />
    </AppShell>
  );
}
