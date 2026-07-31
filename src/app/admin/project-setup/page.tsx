import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectSetupAdminClient } from "@/components/admin/project-setup-admin-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getProjectSetupSettings, listProjectSetupRuns } from "@/lib/project-setup/store";
import { validateSettingsEmails } from "@/lib/project-setup/validation";

export default async function AdminProjectSetupPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const [settings, runs] = await Promise.all([getProjectSetupSettings(), listProjectSetupRuns(30)]);
  const warnings = validateSettingsEmails({
    memberEmails: settings.memberEmails,
    testMemberEmails: settings.testMemberEmails,
  });

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <Link
          href="/admin/connectors"
          className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
        >
          ← Back to Integrations
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Project setup</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Configure standing Slack invites, test mode, and Google folder/spreadsheet IDs used by
          new-project dry-runs.
        </p>
      </div>
      <ProjectSetupAdminClient
        initialSettings={settings}
        initialRuns={runs}
        initialWarnings={warnings}
      />
    </AppShell>
  );
}
