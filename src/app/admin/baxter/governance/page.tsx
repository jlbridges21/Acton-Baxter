import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { GovernanceEditorClient } from "@/components/admin/governance-editor-client";
import { isAdminRole, isSuperAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGovernanceAdminSummary } from "@/lib/baxter-ai/governance";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";

export default async function BaxterGovernancePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const summary = getGovernanceAdminSummary();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/baxter/diagnostics"
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
          >
            ← Back to Diagnostics
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Baxter Governance</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Edit runtime instruction wording through versioned drafts and domain approvals. Section
            set and precedence order stay code-fixed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <CardTitle>Runtime architecture</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.runtimeVersion}
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Code/deploy version (BAXTER_RUNTIME_VERSION)
            </p>
          </Card>
          <Card className="p-4">
            <CardTitle>Governance doc</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.governanceVersion}
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Governance document version (change-control handbook)
            </p>
          </Card>
        </div>

        <GovernanceEditorClient isSuperAdmin={isSuperAdminRole(user.profile.role)} />

        <Card className="p-4">
          <CardTitle>Related configuration</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href="/admin/baxter/rulebook"
                className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                Process Rulebook
              </Link>
            </li>
            {PROCESS_MONITORING_UI_ENABLED ? (
              <li>
                <Link
                  href="/admin/baxter/monitoring"
                  className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  Process Monitoring
                </Link>
              </li>
            ) : null}
            <li>
              <Link
                href="/admin/knowledge/settings"
                className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                Knowledge Settings
              </Link>
            </li>
          </ul>
        </Card>

        <Card className="p-4">
          <CardTitle>Open decisions (PLACEHOLDER)</CardTitle>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">{summary.note}</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--acton-navy)]">
            {summary.openDecisions.length === 0 ? (
              <li>None parsed</li>
            ) : (
              summary.openDecisions.map((item, i) => <li key={`p-${i}`}>{item.text}</li>)
            )}
          </ul>
        </Card>

        <Card className="p-4">
          <CardTitle>Unresolved risks (RED FLAG)</CardTitle>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--acton-navy)]">
            {summary.unresolvedRisks.length === 0 ? (
              <li>None parsed</li>
            ) : (
              summary.unresolvedRisks.map((item, i) => <li key={`r-${i}`}>{item.text}</li>)
            )}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
