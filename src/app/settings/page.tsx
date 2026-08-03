import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import type { UserRole } from "@/lib/research/types";
import Link from "next/link";

export default async function AccountSettingsPage() {
  const user = await requireActiveUser();
  const role = user.profile.role as UserRole;
  const roleLabel = ROLE_LABELS[role] ?? role;
  const department =
    user.profile.department?.trim() || user.profile.department_name?.trim() || "Not set";

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Settings</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Your account details. Contact an admin to change role or department.
          </p>
        </div>

        <Card>
          <CardTitle>Account</CardTitle>
          <CardDescription className="mt-2">Read-only profile information.</CardDescription>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-[var(--acton-muted)]">Name</dt>
              <dd className="font-medium text-[var(--acton-navy)]">
                {user.profile.full_name || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Email</dt>
              <dd className="font-medium text-[var(--acton-navy)]">{user.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Role</dt>
              <dd className="font-medium text-[var(--acton-navy)]">
                {roleLabel} <span className="text-[var(--acton-muted)]">({role})</span>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Department</dt>
              <dd className="font-medium text-[var(--acton-navy)]">{department}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>Integrations</CardTitle>
          <CardDescription className="mt-2">
            Connect your personal Slack search credentials.
          </CardDescription>
          <div className="mt-4">
            <Link
              href="/settings/integrations"
              className="text-sm font-semibold text-[var(--acton-navy)] underline"
            >
              Open Integrations →
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
