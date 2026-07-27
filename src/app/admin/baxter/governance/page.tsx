import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGovernanceAdminSummary } from "@/lib/baxter-ai/governance";

export default async function BaxterGovernancePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const summary = getGovernanceAdminSummary();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter governance</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Admin-only. PLACEHOLDER and RED FLAG items are planning notes — not live employee
            policy.
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
          <CardTitle>Canonical standards</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.canonicalStandards.map((s) => (
              <li key={s.path}>
                <span className="font-semibold text-[var(--acton-navy)]">{s.title}</span>
                <span className="text-[var(--acton-muted)]">
                  {" "}
                  · v{s.version} · {s.role} · {s.path}
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

        <p className="text-sm">
          <Link
            href="/admin/baxter/diagnostics"
            className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            ← Back to diagnostics
          </Link>
          {" · "}
          <Link
            href="/admin/baxter/evaluations"
            className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            Evaluations
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
