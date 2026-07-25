import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeAnalytics } from "@/lib/knowledge/analytics";
import { getGoogleAdminOverview } from "@/lib/connectors/google/diagnostics";
import { getEnv } from "@/lib/env";
import { isGoogleOAuthConfigured } from "@/lib/connectors/google/oauth-config";

export default async function KnowledgeSettingsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const analytics = await getKnowledgeAnalytics().catch(() => null);
  let googleLabel = "Disconnected";
  let googleEmail: string | null = null;
  try {
    const overview = await getGoogleAdminOverview();
    googleLabel = overview.managerHealth.label;
    googleEmail =
      overview.config.connection?.google_account_email ?? overview.config.clientEmail ?? null;
  } catch {
    // ignore
  }

  let envSnapshot: {
    model: string;
    openaiModel: string;
    uploadMaxMb: string;
    chatEnabled: boolean;
    oauthConfigured: boolean;
  };
  try {
    const env = getEnv();
    envSnapshot = {
      model: env.BAXTER_LLM_PROVIDER,
      openaiModel: env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
      uploadMaxMb: process.env.KNOWLEDGE_UPLOAD_MAX_MB || "20",
      chatEnabled: env.BAXTER_CHAT_ENABLED,
      oauthConfigured: isGoogleOAuthConfigured(),
    };
  } catch {
    envSnapshot = {
      model: "unknown",
      openaiModel: "unknown",
      uploadMaxMb: "20",
      chatEnabled: true,
      oauthConfigured: false,
    };
  }

  return (
    <AppShell user={user}>
      <Suspense fallback={<div>Loading…</div>}>
        <KnowledgeCenterShell
          title="Settings"
          subtitle="Knowledge Center configuration at a glance."
          activeView="settings"
          hideTopActions
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardTitle className="text-base">Uploads</CardTitle>
              <CardDescription className="mt-2">
                Supported: Markdown, text, PDF, Word (DOCX), CSV, Excel (XLSX).
              </CardDescription>
              <p className="mt-3 text-sm">
                Max size: <strong>{envSnapshot.uploadMaxMb} MB</strong> per file
              </p>
            </Card>
            <Card>
              <CardTitle className="text-base">Baxter model</CardTitle>
              <dl className="mt-3 space-y-1 text-sm">
                <div>
                  Provider: <strong>{envSnapshot.model}</strong>
                </div>
                <div>
                  OpenAI model: <strong>{envSnapshot.openaiModel}</strong>
                </div>
                <div>
                  Web chat: <strong>{envSnapshot.chatEnabled ? "Enabled" : "Disabled"}</strong>
                </div>
              </dl>
            </Card>
            <Card>
              <CardTitle className="text-base">Google Workspace</CardTitle>
              <dl className="mt-3 space-y-1 text-sm">
                <div>
                  Status: <strong>{googleLabel}</strong>
                </div>
                <div>
                  Account: <strong>{googleEmail ?? "—"}</strong>
                </div>
                <div>
                  OAuth configured: <strong>{envSnapshot.oauthConfigured ? "Yes" : "No"}</strong>
                </div>
              </dl>
            </Card>
            <Card>
              <CardTitle className="text-base">Knowledge totals</CardTitle>
              {analytics ? (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>Total: {analytics.totals.total}</div>
                  <div>Approved: {analytics.totals.approved}</div>
                  <div>Drafts: {analytics.totals.drafts}</div>
                  <div>Archived: {analytics.totals.archived}</div>
                  <div>Uploads: {analytics.totals.uploaded}</div>
                  <div>Google: {analytics.totals.google}</div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-[var(--acton-muted)]">Unavailable</p>
              )}
            </Card>
            <Card className="md:col-span-2">
              <CardTitle className="text-base">Slack</CardTitle>
              <CardDescription className="mt-2">
                Slack Baxter uses the same retrieval and answer pipeline as the website. Manage
                Slack from Admin → Slack.
              </CardDescription>
            </Card>
          </div>
        </KnowledgeCenterShell>
      </Suspense>
    </AppShell>
  );
}
