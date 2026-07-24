import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getAdminSlackSnapshot } from "@/lib/slack/admin";
import { AdminSlackDiagnosticsClient } from "@/components/admin/admin-slack-diagnostics-client";

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

export default async function AdminSlackPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const snapshot = await getAdminSlackSnapshot();
  const { health, config, stats, activity } = snapshot;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Slack</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Deployment status, health, recent activity, and admin diagnostics for Baxter in Slack.
          </p>
        </div>

        <Card>
          <CardTitle>Health</CardTitle>
          <CardDescription className="mt-2 text-lg font-semibold text-[var(--acton-navy)]">
            {health.label} ({health.status})
          </CardDescription>
          <p className="mt-2 text-sm text-[var(--acton-muted)]">{health.details}</p>
        </Card>

        <Card>
          <CardTitle>Slack configuration</CardTitle>
          <dl className="mt-3 grid gap-2 text-sm text-[var(--acton-navy)] md:grid-cols-2">
            <div>
              Integration enabled: <YesNo value={config.integrationEnabled} />
            </div>
            <div>
              Signing secret present: <YesNo value={config.signingSecretPresent} />
            </div>
            <div>
              Bot token present: <YesNo value={config.botTokenPresent} />
            </div>
            <div>
              App token present: <YesNo value={config.appTokenPresent} />
            </div>
            <div>
              DMs enabled: <YesNo value={config.dmsEnabled} />
            </div>
            <div>
              Channel mentions enabled: <YesNo value={config.channelMentionsEnabled} />
            </div>
            <div>
              Allowed team IDs:{" "}
              {config.allowedTeamIds.length > 0 ? config.allowedTeamIds.join(", ") : "(none)"}
            </div>
            <div>Allowed channels: {config.allowedChannelCount}</div>
            <div>Allowed users: {config.allowedUserCount || "all workspace humans"}</div>
            <div className="break-all md:col-span-2">
              Events endpoint: {config.eventsEndpointUrl}
            </div>
            <div className="break-all md:col-span-2">
              Property command endpoint: {config.propertyCommandEndpointUrl}
            </div>
            {config.missingRequired.length > 0 ? (
              <div className="font-semibold text-amber-800 md:col-span-2">
                Missing: {config.missingRequired.join(", ")}
              </div>
            ) : null}
          </dl>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Card>
            <CardTitle className="text-base">Events (24h)</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {stats.processedLast24h}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle className="text-base">Pending jobs</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {stats.pendingJobs}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle className="text-base">Failed jobs</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {stats.failedJobs}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle className="text-base">Duplicates ignored</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {stats.duplicatesIgnored}
            </CardDescription>
          </Card>
        </div>

        <Card>
          <CardTitle>Recent health signals</CardTitle>
          <ul className="mt-3 space-y-1 text-sm text-[var(--acton-muted)]">
            <li>Last valid event: {stats.lastValidEventAt ?? "—"}</li>
            <li>Last successful reply: {stats.lastCompletedAt ?? "—"}</li>
            <li>Last failed reply: {stats.lastFailedAt ?? "—"}</li>
            <li>
              Recent error codes:{" "}
              {stats.recentErrorCodes.length > 0 ? stats.recentErrorCodes.join(", ") : "none"}
            </li>
          </ul>
        </Card>

        <Card>
          <CardTitle>Diagnostic actions</CardTitle>
          <CardDescription className="mt-1">
            Admin-only. Test posts require an explicit channel or user ID and never run on page
            load.
          </CardDescription>
          <div className="mt-4">
            <AdminSlackDiagnosticsClient />
          </div>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No Slack conversations yet.</p>
          ) : (
            activity.map((row) => (
              <Card key={row.conversationId}>
                <CardTitle className="text-base">{row.userLabel}</CardTitle>
                <CardDescription className="mt-2">
                  {new Date(row.timestamp).toLocaleString()} · {row.status}
                  {row.errorCode ? ` · ${row.errorCode}` : ""}
                </CardDescription>
                <p className="mt-3 text-sm text-[var(--acton-navy)]">
                  {row.questionExcerpt || "(no question yet)"}
                </p>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  Sources used: {row.sourceCount}
                </p>
                <Link
                  href={`/admin/slack/conversations/${row.conversationId}`}
                  className="mt-3 inline-block text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  Open conversation
                </Link>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
