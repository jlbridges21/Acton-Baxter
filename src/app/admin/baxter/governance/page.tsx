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
      <div className="space-y-8">
        <div>
          <Link
            href="/admin/baxter/diagnostics"
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
          >
            ← Back to Diagnostics
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Baxter Governance</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--acton-muted)]">
            Read and propose changes to Baxter&apos;s live chat wording and the PEM NEAT grading
            standard. Drafts are reviewed by domain owners before they go live — you do not need to
            touch the codebase.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <CardTitle>App runtime</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.runtimeVersion}
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Deployed software version (not the editable content version below)
            </p>
          </Card>
          <Card className="p-4">
            <CardTitle>Governance handbook</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.governanceVersion}
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Change-control document version for architects
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

        {/* Historical planning notes — de-emphasized, collapsed by default */}
        <details className="rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)]/50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--acton-muted)]">
            Historical planning notes (not live policy)
          </summary>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">{summary.note}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Open decisions (PLACEHOLDER)
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[var(--acton-muted)]">
                {summary.openDecisions.length === 0 ? (
                  <li>None parsed</li>
                ) : (
                  summary.openDecisions.map((item, i) => <li key={`p-${i}`}>{item.text}</li>)
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Unresolved risks (RED FLAG)
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[var(--acton-muted)]">
                {summary.unresolvedRisks.length === 0 ? (
                  <li>None parsed</li>
                ) : (
                  summary.unresolvedRisks.map((item, i) => <li key={`r-${i}`}>{item.text}</li>)
                )}
              </ul>
            </div>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
