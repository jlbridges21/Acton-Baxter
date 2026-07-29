"use client";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

function flashMessage(flash: string | null): { tone: "ok" | "err"; text: string } | null {
  if (!flash) return null;
  if (flash === "linked") {
    return { tone: "ok", text: "Slack Search linked successfully." };
  }
  if (flash === "misconfigured" || flash === "redirect_uri") {
    return {
      tone: "err",
      text: "Slack authorization is not configured correctly. Contact a Baxter admin.",
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
        <CardTitle>Slack Search</CardTitle>
        <CardDescription className="mt-1">
          {props.connected ? "Connected" : "Not connected"}
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

      {props.connected ? (
        <dl className="grid gap-2 text-sm text-[var(--acton-navy)] sm:grid-cols-2">
          <div>
            Slack account:{" "}
            <span className="font-medium">{props.slackUserName ?? "Slack user"}</span>
          </div>
          <div>
            Workspace: <span className="font-medium">{props.workspaceLabel}</span>
          </div>
          <div>
            Public channels: <YesNo value={props.capabilities.publicChannels} />
          </div>
          <div>
            Private channels: <YesNo value={props.capabilities.privateChannels} />
          </div>
          <div>
            DMs: <YesNo value={props.capabilities.dms} />
          </div>
          <div>
            Group DMs: <YesNo value={props.capabilities.groupDms} />
          </div>
        </dl>
      ) : (
        <dl className="grid gap-2 text-sm text-[var(--acton-navy)] sm:grid-cols-2">
          <div>
            Public channels: <YesNo value={false} />
          </div>
          <div>
            Private channels: <YesNo value={false} />
          </div>
          <div>
            DMs: <YesNo value={false} />
          </div>
          <div>
            Group DMs: <YesNo value={false} />
          </div>
        </dl>
      )}

      <div className="space-y-2 text-sm text-[var(--acton-muted)]">
        <p>
          Optional personal Slack authorization for searching private channels and DMs you are
          allowed to see.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Public Baxter Q&amp;A can work without linking.</li>
          <li>
            Slash <code className="text-xs">/pem</code> does not require Slack Search — it only
            needs your Slack account to match a Baxter user.
          </li>
          <li>
            Private channel / DM <code className="text-xs">/recall</code> requires this
            authorization.
          </li>
        </ul>
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
