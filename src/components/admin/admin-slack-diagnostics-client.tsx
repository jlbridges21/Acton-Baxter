"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ActionResult = unknown;

type SearchSnapshot = {
  status: "ready" | "needs_setup" | "disabled";
  workspaceLabel: string;
  searchEnabled: boolean;
  readyForUserOauth: boolean;
  missingForUserOauth: string[];
  oauthRedirectUri: string;
  userLevelAuthorization: "configured" | "not_configured" | "partial";
  capabilities: {
    publicChannels: boolean;
    privateChannels: boolean;
    dms: boolean;
    groupDms: boolean;
    threadContext: boolean;
    permalinks: boolean;
  };
  connection: {
    linked: boolean;
    slackUserName: string | null;
    slackUserId: string | null;
    status: string | null;
  } | null;
} | null;

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

export function AdminSlackDiagnosticsClient({ search }: { search?: SearchSnapshot }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [testText, setTestText] = useState("");
  const [dryRunQuestion, setDryRunQuestion] = useState("Who is Baxter?");
  const [sandboxQuery, setSandboxQuery] = useState("RACI matrix");

  async function run(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Request failed");
      }
      setResult(payload.result ?? payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {search ? (
        <div className="space-y-3 rounded-lg border border-[var(--acton-border)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">Slack Search</p>
            <p className="text-sm text-[var(--acton-muted)]">
              {search.status === "ready"
                ? "Ready"
                : search.status === "disabled"
                  ? "Disabled"
                  : "Needs setup"}
            </p>
          </div>
          <dl className="grid gap-2 text-sm text-[var(--acton-navy)] md:grid-cols-2">
            <div>
              Workspace: <span className="font-medium">{search.workspaceLabel}</span>
            </div>
            <div>
              User-level authorization:{" "}
              <span className="font-medium">
                {search.userLevelAuthorization === "configured"
                  ? "Configured"
                  : search.userLevelAuthorization === "partial"
                    ? "Partial (public fallback)"
                    : "Not configured"}
              </span>
            </div>
            <div>
              Public channels: <YesNo value={search.capabilities.publicChannels} />
            </div>
            <div>
              Private channels: <YesNo value={search.capabilities.privateChannels} />
            </div>
            <div>
              DMs: <YesNo value={search.capabilities.dms} />
            </div>
            <div>
              Group DMs: <YesNo value={search.capabilities.groupDms} />
            </div>
            <div>
              Thread context: <YesNo value={search.capabilities.threadContext} />
            </div>
            <div>
              Permalinks: <YesNo value={search.capabilities.permalinks} />
            </div>
          </dl>
          {search.connection?.linked ? (
            <p className="text-sm text-[var(--acton-muted)]">
              Linked as {search.connection.slackUserName ?? "Slack user"}
            </p>
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              Link your Slack account to search with your own visibility (required for private
              channels and DMs).
            </p>
          )}
          {search.missingForUserOauth.length ? (
            <p className="text-sm text-amber-800">
              Missing for user OAuth: {search.missingForUserOauth.join(", ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a href="/api/slack/search/oauth/start">
              <Button type="button">
                {search.connection?.linked ? "Reconnect Slack Search" : "Link Slack Search"}
              </Button>
            </a>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("test_user_resolution", { query: "Jackson Bridges" })}
            >
              {busy === "test_user_resolution" ? "Testing…" : "Test user resolution"}
            </Button>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("test_channel_resolution", { query: "project-management" })}
            >
              {busy === "test_channel_resolution" ? "Testing…" : "Test channel resolution"}
            </Button>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("test_public_search", { query: "RACI matrix" })}
            >
              {busy === "test_public_search" ? "Testing…" : "Test public search"}
            </Button>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("test_thread_retrieval", { query: "RACI matrix" })}
            >
              {busy === "test_thread_retrieval" ? "Testing…" : "Test thread retrieval"}
            </Button>
          </div>

          <div className="space-y-2 border-t border-[var(--acton-border)] pt-3">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">Test Slack Search</p>
            <input
              className="w-full rounded border border-[var(--acton-border)] px-3 py-2 text-sm"
              value={sandboxQuery}
              onChange={(event) => setSandboxQuery(event.target.value)}
              placeholder="e.g. RACI matrix"
            />
            <Button
              type="button"
              disabled={Boolean(busy) || !sandboxQuery.trim()}
              onClick={() => run("sandbox_search", { query: sandboxQuery })}
            >
              {busy === "sandbox_search" ? "Searching…" : "Run search"}
            </Button>
            {result &&
            typeof result === "object" &&
            result !== null &&
            "results" in (result as object) ? (
              <ul className="mt-2 space-y-2 text-sm text-[var(--acton-navy)]">
                {((result as { results?: Array<Record<string, string | null>> }).results ?? []).map(
                  (row, index) => (
                    <li
                      key={`${row.timestamp}-${index}`}
                      className="rounded border border-[var(--acton-border)] p-2"
                    >
                      <p className="font-medium">
                        {row.author} · {row.channel}
                      </p>
                      <p className="text-[var(--acton-muted)]">{row.timestamp}</p>
                      <p>{row.excerpt}</p>
                      {row.permalink ? (
                        <a
                          className="text-[var(--acton-blue)] underline"
                          href={row.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Slack
                        </a>
                      ) : null}
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={Boolean(busy)} onClick={() => run("test_auth")}>
          {busy === "test_auth" ? "Testing…" : "Test Slack authentication"}
        </Button>
        <Button type="button" disabled={Boolean(busy)} onClick={() => run("verify_events_config")}>
          {busy === "verify_events_config" ? "Checking…" : "Verify Events API config"}
        </Button>
        <Button type="button" disabled={Boolean(busy)} onClick={() => run("process_one_job")}>
          {busy === "process_one_job" ? "Processing…" : "Process one pending Slack job"}
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-[var(--acton-border)] p-4">
        <p className="text-sm font-semibold text-[var(--acton-navy)]">
          Test post (explicit destination)
        </p>
        <input
          className="w-full rounded border border-[var(--acton-border)] px-3 py-2 text-sm"
          placeholder="Channel ID (C…) or user ID (U…)"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
        />
        <input
          className="w-full rounded border border-[var(--acton-border)] px-3 py-2 text-sm"
          placeholder="Optional message text"
          value={testText}
          onChange={(event) => setTestText(event.target.value)}
        />
        <Button
          type="button"
          disabled={Boolean(busy) || !destination.trim()}
          onClick={() =>
            run("test_post", { channelOrUserId: destination, text: testText || undefined })
          }
        >
          {busy === "test_post" ? "Posting…" : "Post test message"}
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-[var(--acton-border)] p-4">
        <p className="text-sm font-semibold text-[var(--acton-navy)]">
          Pipeline dry-run (no Slack post)
        </p>
        <input
          className="w-full rounded border border-[var(--acton-border)] px-3 py-2 text-sm"
          value={dryRunQuestion}
          onChange={(event) => setDryRunQuestion(event.target.value)}
        />
        <Button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run("pipeline_dry_run", { question: dryRunQuestion })}
        >
          {busy === "pipeline_dry_run" ? "Running…" : "Test Baxter Slack answer pipeline"}
        </Button>
      </div>

      {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      {result ? (
        <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs text-[var(--acton-navy)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
