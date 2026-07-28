import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { DepartmentsSettingsClient } from "@/components/admin/departments-settings-client";
import { isAdminRole, ROLE_LABELS } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listDepartments } from "@/lib/org/departments";
import { getEnv } from "@/lib/env";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";

export default async function BaxterSettingsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const departments = await listDepartments({ includeInactive: true });

  let aiStatus = {
    provider: "openai",
    model: "—",
    fallback: "—",
    chatEnabled: false,
  };
  try {
    const env = getEnv();
    aiStatus = {
      provider: env.AI_PROVIDER || "openai",
      model: (env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini").trim(),
      fallback: (env.BAXTER_OPENAI_FALLBACK_MODEL || "").trim() || "None",
      chatEnabled: Boolean(env.BAXTER_CHAT_ENABLED),
    };
  } catch {
    // env may be incomplete in some test setups
  }

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter Settings</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Organization, AI status, and links to specialized admin areas.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">General</h2>
          <Card>
            <CardTitle>Baxter by Acton ADU</CardTitle>
            <CardDescription>
              Internal tools platform for Acton team members. Product configuration that belongs in
              specialized areas is linked below rather than duplicated here.
            </CardDescription>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Users & Organization</h2>
          <Card>
            <CardTitle>Application roles</CardTitle>
            <CardDescription className="mt-2">
              System-defined permission roles (not editable):
            </CardDescription>
            <ul className="mt-3 space-y-1 text-sm text-[var(--acton-navy)]">
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <li key={key}>
                  <span className="font-medium">{label}</span>
                  <span className="text-[var(--acton-muted)]"> ({key})</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-[var(--acton-muted)]">
              Manage people on the{" "}
              <Link href="/admin/users" className="font-medium text-[var(--acton-navy)] underline">
                Users
              </Link>{" "}
              page. Departments are job functions, separate from application permissions.
            </p>
          </Card>
          <DepartmentsSettingsClient initialDepartments={departments} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">AI & Models</h2>
          <Card>
            <CardTitle>Provider status</CardTitle>
            <CardDescription>
              Controlled by environment configuration (read-only). API keys are never shown here.
            </CardDescription>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-[var(--acton-muted)]">Primary provider</dt>
                <dd className="font-medium text-[var(--acton-navy)]">{aiStatus.provider}</dd>
              </div>
              <div>
                <dt className="text-[var(--acton-muted)]">Model</dt>
                <dd className="font-medium text-[var(--acton-navy)]">{aiStatus.model}</dd>
              </div>
              <div>
                <dt className="text-[var(--acton-muted)]">Fallback</dt>
                <dd className="font-medium text-[var(--acton-navy)]">{aiStatus.fallback}</dd>
              </div>
              <div>
                <dt className="text-[var(--acton-muted)]">Web chat</dt>
                <dd className="font-medium text-[var(--acton-navy)]">
                  {aiStatus.chatEnabled ? "Enabled" : "Disabled"}
                </dd>
              </div>
            </dl>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Knowledge</h2>
          <Card>
            <CardTitle>Knowledge Settings</CardTitle>
            <CardDescription>
              Index status, upload limits, and Knowledge Center configuration.
            </CardDescription>
            <div className="mt-4">
              <Link
                href="/admin/knowledge/settings"
                className="text-sm font-semibold text-[var(--acton-navy)] underline"
              >
                Open Knowledge Settings →
              </Link>
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Integrations</h2>
          <Card>
            <CardTitle>Connectors</CardTitle>
            <CardDescription>Google Workspace, Slack, GHL, and other connectors.</CardDescription>
            <div className="mt-4">
              <Link
                href="/admin/connectors"
                className="text-sm font-semibold text-[var(--acton-navy)] underline"
              >
                Open Integrations →
              </Link>
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Process</h2>
          <Card>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/admin/baxter/rulebook"
                  className="font-semibold text-[var(--acton-navy)] underline"
                >
                  Process Rulebook
                </Link>
              </li>
              {PROCESS_MONITORING_UI_ENABLED ? (
                <li>
                  <Link
                    href="/admin/baxter/monitoring"
                    className="font-semibold text-[var(--acton-navy)] underline"
                  >
                    Process Monitoring
                  </Link>
                </li>
              ) : null}
              <li>
                <Link
                  href="/admin/baxter/governance"
                  className="font-semibold text-[var(--acton-navy)] underline"
                >
                  Baxter Governance
                </Link>
              </li>
            </ul>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Advanced</h2>
          <Card>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/admin/baxter/diagnostics"
                  className="font-semibold text-[var(--acton-navy)] underline"
                >
                  Diagnostics
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/baxter/launch-readiness"
                  className="font-semibold text-[var(--acton-navy)] underline"
                >
                  Launch Readiness
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/baxter/evaluations"
                  className="font-semibold text-[var(--acton-navy)] underline"
                >
                  Evaluations
                </Link>
              </li>
            </ul>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
