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

export function SlackIntegrationsClient(props: {
  searchEnabled: boolean;
  connected: boolean;
  slackUserName: string | null;
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
  return (
    <Card className="space-y-4 p-5">
      <div>
        <CardTitle>Slack Search</CardTitle>
        <CardDescription className="mt-1">
          {props.connected ? "Connected" : "Not connected"}
          {props.slackUserName ? ` · ${props.slackUserName}` : ""}
        </CardDescription>
      </div>

      {props.flash === "linked" ? (
        <p className="text-sm font-medium text-emerald-700">Slack Search linked successfully.</p>
      ) : null}
      {props.flash && props.flash !== "linked" ? (
        <p className="text-sm font-medium text-red-700">
          Slack linking issue: {props.flash.replace(/_/g, " ")}
        </p>
      ) : null}

      {!props.searchEnabled ? (
        <p className="text-sm text-amber-800">
          Slack Search is disabled for this environment (`ENABLE_SLACK_SEARCH`).
        </p>
      ) : null}

      <dl className="grid gap-2 text-sm text-[var(--acton-navy)] sm:grid-cols-2">
        <div>
          Public channels: <YesNo value={props.connected && props.capabilities.publicChannels} />
        </div>
        <div>
          Private channels: <YesNo value={props.connected && props.capabilities.privateChannels} />
        </div>
        <div>
          DMs: <YesNo value={props.connected && props.capabilities.dms} />
        </div>
        <div>
          Group DMs: <YesNo value={props.connected && props.capabilities.groupDms} />
        </div>
      </dl>

      <p className="text-sm text-[var(--acton-muted)]">
        Baxter searches Slack live when you ask about conversations, updates, or decisions. It does
        not copy your Slack history into Baxter, and it cannot see private content you have not
        authorized.
      </p>

      {props.missing.length ? (
        <p className="text-sm text-amber-800">Setup incomplete: {props.missing.join(", ")}</p>
      ) : null}

      <a href="/api/slack/search/oauth/start?self=1&return=/settings/integrations">
        <Button type="button" disabled={!props.searchEnabled || !props.oauthReady}>
          {props.connected ? "Reconnect Slack Search" : "Connect Slack Search"}
        </Button>
      </a>
    </Card>
  );
}
