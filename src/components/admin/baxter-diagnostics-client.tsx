"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type Snapshot = {
  config: {
    chatEnabled: boolean;
    provider: string;
    model: string;
    openaiKeyPresent: boolean;
    supabaseServiceRolePresent: boolean;
    googleConfigured: boolean;
    slackConfigured: boolean;
  };
  knowledge: {
    total: number;
    approvedInternal: number;
    draft: number;
    archived: number;
    googleSynced: number;
    manual: number;
    lastGoogleSync: string | null;
  };
  conversations: {
    last24h: number;
    successfulAssistantResponses: number;
    insufficientKnowledgeResponses: number;
    failedResponses: number;
    recentErrorCodes: string[];
  };
};

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

export function BaxterDiagnosticsClient({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/baxter/diagnostics");
    const payload = await response.json();
    if (response.ok) setSnapshot(payload);
  }

  async function run(action: string) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/baxter/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setResult(payload.error?.message ?? "Diagnostic failed");
      } else {
        setResult(JSON.stringify(payload.result, null, 2));
        await refresh();
      }
    } catch {
      setResult("Diagnostic request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter diagnostics</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Admin-only health checks. Secret values are never displayed.
        </p>
      </div>

      <Card>
        <CardTitle>Configuration</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--acton-muted)]">Chat enabled</dt>
            <dd>
              <YesNo value={snapshot.config.chatEnabled} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Provider / model</dt>
            <dd>
              {snapshot.config.provider} / {snapshot.config.model}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">OpenAI key present</dt>
            <dd>
              <YesNo value={snapshot.config.openaiKeyPresent} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Supabase service role present</dt>
            <dd>
              <YesNo value={snapshot.config.supabaseServiceRolePresent} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Google connector configured</dt>
            <dd>
              <YesNo value={snapshot.config.googleConfigured} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Slack integration configured</dt>
            <dd>
              <YesNo value={snapshot.config.slackConfigured} />
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Knowledge Base health</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--acton-muted)]">Total</dt>
            <dd>{snapshot.knowledge.total}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Approved internal</dt>
            <dd>{snapshot.knowledge.approvedInternal}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Draft / archived</dt>
            <dd>
              {snapshot.knowledge.draft} / {snapshot.knowledge.archived}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Google / manual</dt>
            <dd>
              {snapshot.knowledge.googleSynced} / {snapshot.knowledge.manual}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--acton-muted)]">Last Google sync</dt>
            <dd>
              {snapshot.knowledge.lastGoogleSync
                ? new Date(snapshot.knowledge.lastGoogleSync).toLocaleString()
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Conversation health (24h sample)</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--acton-muted)]">Conversations</dt>
            <dd>{snapshot.conversations.last24h}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Successful / insufficient / failed</dt>
            <dd>
              {snapshot.conversations.successfulAssistantResponses} /{" "}
              {snapshot.conversations.insufficientKnowledgeResponses} /{" "}
              {snapshot.conversations.failedResponses}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--acton-muted)]">Recent error codes</dt>
            <dd>
              {snapshot.conversations.recentErrorCodes.length
                ? snapshot.conversations.recentErrorCodes.join(", ")
                : "None"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Built-in tests</CardTitle>
        <CardDescription className="mt-2">
          These call the real shared services (OpenAI only when configured).
        </CardDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run("test_openai")}>
            Test OpenAI
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => void run("test_knowledge")}>
            Test Knowledge search
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => void run("test_pipeline")}>
            Test complete pipeline
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void run("bootstrap_overview")}
          >
            Create Baxter Overview entry
          </Button>
        </div>
        {result ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs text-[var(--acton-navy)]">
            {result}
          </pre>
        ) : null}
      </Card>
    </div>
  );
}
