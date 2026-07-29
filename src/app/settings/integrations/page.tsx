import { AppShell } from "@/components/layout/app-shell";
import { requireActiveUser } from "@/lib/auth/session";
import { getSlackSearchConnectionMetadata } from "@/lib/baxter-data/slack/connections";
import { getSlackSearchRuntimeConfig, scopesToCapabilities } from "@/lib/baxter-data/slack/config";
import { SlackIntegrationsClient } from "@/components/settings/slack-integrations-client";

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const linked = await getSlackSearchConnectionMetadata(user.profile.id);
  const config = getSlackSearchRuntimeConfig();
  const caps = scopesToCapabilities(linked?.scopes ?? []);

  const flash =
    typeof params.slack_search === "string"
      ? params.slack_search
      : typeof params.slack_search_error === "string"
        ? params.slack_search_error
        : null;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Integrations</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Connect personal services Baxter uses on your behalf. Slack Search only retrieves
            conversations your Slack account is allowed to see.
          </p>
        </div>
        <SlackIntegrationsClient
          searchEnabled={config.searchEnabled}
          connected={Boolean(linked?.linked)}
          slackUserName={linked?.slackUserName ?? null}
          status={linked?.status ?? null}
          capabilities={{
            publicChannels: caps.publicChannels,
            privateChannels: caps.privateChannels,
            dms: caps.dms,
            groupDms: caps.groupDms,
          }}
          oauthReady={config.readyForUserOauth}
          missing={config.missingForUserOauth}
          flash={flash}
        />
      </div>
    </AppShell>
  );
}
