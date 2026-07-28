import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
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
            Review the rules and safeguards that control how Baxter answers questions and uses
            connected systems.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <CardTitle>Runtime</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.runtimeVersion}
            </CardDescription>
          </Card>
          <Card className="p-4">
            <CardTitle>Governance</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              v{summary.governanceVersion}
            </CardDescription>
          </Card>
        </div>

        <Card className="p-4">
          <CardTitle>Related configuration</CardTitle>
          <CardDescription className="mt-1">
            These tools define Acton process and proactive checks. They live in the Knowledge
            Center.
          </CardDescription>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href="/admin/baxter/rulebook"
                className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                Process Rulebook
              </Link>
              <span className="text-[var(--acton-muted)]">
                {" "}
                — stages, roles, RACI, and required data
              </span>
            </li>
            {PROCESS_MONITORING_UI_ENABLED ? (
              <li>
                <Link
                  href="/admin/baxter/monitoring"
                  className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  Process Monitoring
                </Link>
                <span className="text-[var(--acton-muted)]">
                  {" "}
                  — proactive GHL checks and findings
                </span>
              </li>
            ) : null}
            <li>
              <Link
                href="/admin/knowledge/settings"
                className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                Knowledge Settings
              </Link>
              <span className="text-[var(--acton-muted)]"> — Knowledge Center configuration</span>
            </li>
          </ul>
        </Card>

        <Card className="p-4">
          <CardTitle>Canonical standards</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.canonicalStandards.map((s) => (
              <li key={s.path}>
                <span className="font-semibold text-[var(--acton-navy)]">{s.title}</span>
                <span className="text-[var(--acton-muted)]">
                  {" "}
                  · v{s.version} · {s.role}
                </span>
              </li>
            ))}
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
