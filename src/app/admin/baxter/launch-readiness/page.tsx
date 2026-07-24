import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getLaunchReadinessSnapshot } from "@/lib/baxter-ai/launch-readiness";

export default async function LaunchReadinessPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const snapshot = await getLaunchReadinessSnapshot();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Launch readiness</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Whether Baxter is ready for Acton employees. Status requires successful checks — not
            only environment variables.
          </p>
        </div>

        <Card>
          <CardTitle>Overall status</CardTitle>
          <CardDescription className="mt-2 text-xl font-semibold text-[var(--acton-navy)]">
            {snapshot.overallLabel}
          </CardDescription>
          {snapshot.blockers.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
              {snapshot.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {snapshot.attention.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {snapshot.attention.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Web chat</CardTitle>
            <ul className="mt-2 space-y-1 text-sm text-[var(--acton-muted)]">
              <li>Enabled: {snapshot.webChat.enabled ? "Yes" : "No"}</li>
              <li>OpenAI key: {snapshot.webChat.openaiKeyPresent ? "Yes" : "No"}</li>
              <li>Recent successful answers: {snapshot.webChat.recentSuccessfulAnswers}</li>
              <li>Recent failures: {snapshot.webChat.recentFailures}</li>
              <li>Last OpenAI error: {snapshot.webChat.lastOpenAiError ?? "—"}</li>
            </ul>
          </Card>
          <Card>
            <CardTitle>Knowledge Base</CardTitle>
            <ul className="mt-2 space-y-1 text-sm text-[var(--acton-muted)]">
              <li>Approved entries: {snapshot.knowledge.approvedEntries}</li>
              <li>Google-synced entries: {snapshot.knowledge.googleSyncedEntries}</li>
              <li>Last Google sync: {snapshot.knowledge.lastGoogleSync ?? "—"}</li>
            </ul>
          </Card>
          <Card>
            <CardTitle>Google</CardTitle>
            <ul className="mt-2 space-y-1 text-sm text-[var(--acton-muted)]">
              <li>Configured: {snapshot.google.configured ? "Yes" : "No"}</li>
              <li>Private key valid: {snapshot.google.privateKeyValid ? "Yes" : "No"}</li>
              <li>Authenticated: {snapshot.google.authenticated ? "Yes" : "No"}</li>
              <li>Root folder set: {snapshot.google.rootFolderConfigured ? "Yes" : "No"}</li>
              <li>Last error: {snapshot.google.lastError ?? "—"}</li>
            </ul>
          </Card>
          <Card>
            <CardTitle>Slack</CardTitle>
            <ul className="mt-2 space-y-1 text-sm text-[var(--acton-muted)]">
              <li>Enabled: {snapshot.slack.enabled ? "Yes" : "No"}</li>
              <li>Config complete: {snapshot.slack.configComplete ? "Yes" : "No"}</li>
              <li>Status: {snapshot.slack.status}</li>
              <li>Last successful reply: {snapshot.slack.lastSuccessfulReply ?? "—"}</li>
              <li>
                Jobs pending/failed: {snapshot.slack.pendingJobs}/{snapshot.slack.failedJobs}
              </li>
            </ul>
          </Card>
        </div>

        <Card>
          <CardTitle>Security</CardTitle>
          <ul className="mt-2 space-y-1 text-sm text-[var(--acton-muted)]">
            <li>
              Service role present: {snapshot.security.supabaseServiceRolePresent ? "Yes" : "No"}
            </li>
            <li>Cron secret configured: {snapshot.security.cronSecretConfigured ? "Yes" : "No"}</li>
            <li>App URL HTTPS: {snapshot.security.productionHttps ? "Yes" : "No"}</li>
            <li>App URL: {snapshot.security.appBaseUrl}</li>
          </ul>
        </Card>

        <Card>
          <CardTitle>Admin resources</CardTitle>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-[var(--acton-navy)]">
            <Link className="underline-offset-2 hover:underline" href="/admin/baxter/diagnostics">
              Baxter diagnostics
            </Link>
            <Link className="underline-offset-2 hover:underline" href="/admin/connectors/google">
              Google connector
            </Link>
            <Link className="underline-offset-2 hover:underline" href="/admin/slack">
              Slack diagnostics
            </Link>
            <Link className="underline-offset-2 hover:underline" href="/admin/knowledge">
              Knowledge Base
            </Link>
            <Link className="underline-offset-2 hover:underline" href="/admin/baxter/feedback">
              Feedback
            </Link>
          </div>
          <p className="mt-3 text-xs text-[var(--acton-muted)]">
            Repository docs: docs/production-checklist.md · docs/slack-setup.md ·
            docs/google-connector.md · docs/baxter-troubleshooting.md ·
            docs/baxter-employee-guide.md
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
