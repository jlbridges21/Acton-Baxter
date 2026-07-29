"use client";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

function StatusLabel({
  value,
  yes = "Available",
  no = "Not connected",
}: {
  value: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>
      {value ? yes : no}
    </span>
  );
}

function flashMessage(flash: string | null): { tone: "ok" | "err"; text: string } | null {
  if (!flash) return null;
  if (flash === "linked") {
    return { tone: "ok", text: "Slack Search connected successfully." };
  }
  if (flash === "misconfigured" || flash === "redirect_uri") {
    return {
      tone: "err",
      text: "Slack authorization is not configured correctly. Contact a Baxter admin (Redirect URL may be missing in Slack).",
    };
  }
  if (flash === "oauth_cancelled") {
    return { tone: "err", text: "Slack authorization was cancelled." };
  }
  if (flash === "disabled") {
    return { tone: "err", text: "Slack Search is disabled for this environment." };
  }
  return { tone: "err", text: `Slack linking issue: ${flash.replace(/_/g, " ")}` };
}

export function SlackIntegrationsClient(props: {
  searchEnabled: boolean;
  connected: boolean;
  slackUserName: string | null;
  workspaceLabel: string;
  status: string | null;
  /** Baxter bot can recall public channel history without personal OAuth. */
  botPublicRecallAvailable: boolean;
  capabilities: {
    publicChannels: boolean;
    privateChannels: boolean;
    dms: boolean;
    groupDms: boolean;
  };
  oauthReady: boolean;
  missing: string[];
  flash: string | null;
}) {
  const flash = flashMessage(props.flash);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <CardTitle>Slack Recall</CardTitle>
        <CardDescription className="mt-1">
          Baxter&apos;s normal Slack access vs optional personal Slack Search authorization.
        </CardDescription>
      </div>

      {flash ? (
        <p
          className={
            flash.tone === "ok"
              ? "text-sm font-medium text-emerald-700"
              : "text-sm font-medium text-red-700"
          }
        >
          {flash.text}
        </p>
      ) : null}

      {!props.searchEnabled ? (
        <p className="text-sm text-amber-800">
          Slack Search is disabled for this environment (`ENABLE_SLACK_SEARCH`).
        </p>
      ) : null}

      <div className="space-y-3 rounded-md border border-[var(--acton-border)] p-3">
        <p className="text-sm font-semibold text-[var(--acton-navy)]">Baxter access</p>
        <dl className="grid gap-2 text-sm text-[var(--acton-navy)] sm:grid-cols-2">
          <div>
            Public channel recall:{" "}
            <StatusLabel value={props.botPublicRecallAvailable} no="Unavailable" />
          </div>
          <div>
            Workspace: <span className="font-medium">{props.workspaceLabel}</span>
          </div>
        </dl>
        <p className="text-xs text-[var(--acton-muted)]">
          Public `/recall` and `@Baxter` questions can use Baxter&apos;s bot token without personal
          OAuth when the bot can access the channel.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-[var(--acton-border)] p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--acton-navy)]">Personal Slack Search</p>
          <p className="text-sm text-[var(--acton-muted)]">
            {props.connected ? "Connected" : "Not connected"}
          </p>
        </div>
        {props.connected ? (
          <p className="text-sm text-[var(--acton-navy)]">
            Connected as: <span className="font-medium">{props.slackUserName ?? "Slack user"}</span>
          </p>
        ) : null}
        <dl className="grid gap-2 text-sm text-[var(--acton-navy)] sm:grid-cols-2">
          <div>
            Private channel search:{" "}
            <StatusLabel
              value={props.connected && props.capabilities.privateChannels}
              yes="Yes"
              no="Not connected"
            />
          </div>
          <div>
            DM search:{" "}
            <StatusLabel
              value={props.connected && props.capabilities.dms}
              yes="Yes"
              no="Not connected"
            />
          </div>
          <div>
            Group DM search:{" "}
            <StatusLabel
              value={props.connected && props.capabilities.groupDms}
              yes="Yes"
              no="Not connected"
            />
          </div>
          <div>
            Public search (your token):{" "}
            <StatusLabel
              value={props.connected && props.capabilities.publicChannels}
              yes="Yes"
              no="Not connected"
            />
          </div>
        </dl>
        <p className="text-xs text-[var(--acton-muted)]">
          Connect your Slack account only when you need Baxter to search private channels and DMs
          you can access. Slash `/pem` does not require this — it only needs your Slack account to
          match a Baxter user.
        </p>
      </div>

      {props.missing.length ? (
        <p className="text-sm text-amber-800">Setup incomplete: {props.missing.join(", ")}</p>
      ) : null}

      <a href="/api/slack/search/oauth/start?return=/settings/integrations">
        <Button type="button" disabled={!props.searchEnabled || !props.oauthReady}>
          {props.connected ? "Reconnect Slack Search" : "Connect Slack Search"}
        </Button>
      </a>
    </Card>
  );
}
