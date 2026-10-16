"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { surveyFetch } from "./survey-api";

type Channel = { id: string; name: string; isPrivate: boolean };

type ShareSlackProps = {
  open: boolean;
  onClose: () => void;
  surveyId: string;
  surveyTitle: string;
  onShared: (channelName: string) => void;
};

export function ShareSlackDialog(props: ShareSlackProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose}>
      {/* Remount on open so each share starts clean. */}
      {props.open ? <ShareSlackBody key="share-open" {...props} /> : null}
    </Dialog>
  );
}

function ShareSlackBody({ onClose, surveyId, surveyTitle, onShared }: ShareSlackProps) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [filter, setFilter] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    surveyFetch<{ configured: boolean; channels: Channel[] }>("/api/surveys/slack/channels")
      .then((data) => {
        if (cancelled) return;
        setConfigured(data.configured);
        setChannels(data.channels);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load channels.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^#/, "");
    return q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;
  }, [channels, filter]);

  async function share() {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      setError("Pick a Slack channel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await surveyFetch(`/api/surveys/${surveyId}/share-slack`, {
        method: "POST",
        body: JSON.stringify({ channelId, message }),
      });
      onShared(channel.name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share to Slack.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share to Slack</DialogTitle>
        <DialogDescription>Post a link to “{surveyTitle}” in a channel.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {loading ? (
          <p className="text-sm text-[var(--acton-muted)]">Loading channels…</p>
        ) : !configured ? (
          <p className="text-sm text-[var(--acton-navy)]" data-testid="slack-not-configured">
            Slack isn&apos;t set up for Baxter yet. Ask an admin to connect it, or copy the link and
            paste it in Slack yourself.
          </p>
        ) : (
          <>
            <div>
              <label
                htmlFor="slack-channel-filter"
                className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              >
                Channel
              </label>
              <Input
                id="slack-channel-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter channels"
              />
              <select
                aria-label="Slack channel"
                size={6}
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--acton-border)] bg-white p-1 text-sm text-[var(--acton-navy)]"
              >
                {visible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.isPrivate ? "🔒 " : "#"}
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--acton-muted)]">
                {channels.length === 0
                  ? "Baxter isn't in any channels yet. Invite the Baxter app to a channel first."
                  : "Only channels Baxter has been invited to are listed."}
              </p>
            </div>
            <div>
              <label
                htmlFor="slack-share-message"
                className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              >
                Message (optional)
              </label>
              <textarea
                id="slack-share-message"
                value={message}
                maxLength={1000}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
                placeholder="Please take two minutes to fill this out."
              />
            </div>
          </>
        )}
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || loading || !configured || !channelId}
          onClick={() => void share()}
        >
          {busy ? "Sharing…" : "Share"}
        </Button>
      </DialogFooter>
    </>
  );
}
