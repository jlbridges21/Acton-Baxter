"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type Snapshot = {
  config: {
    chatEnabled: boolean;
    provider: string;
    model: string;
    fallbackModel?: string | null;
    openaiKeyPresent: boolean;
    supabaseServiceRolePresent: boolean;
    googleConfigured: boolean;
    slackConfigured: boolean;
  };
  openai?: {
    lastSuccessfulRequest: string | null;
    lastFailedRequest: string | null;
    lastSafeErrorCode: string | null;
    lastHttpStatus: number | null;
    lastProviderRequestId: string | null;
    averageLatencyMs: number | null;
    requestsLastHour: number;
    rateLimitErrorsLastHour: number;
    quotaErrorsLast24h: number;
    totalRetries: number;
    duplicatesPrevented: number;
    lastInputTokens: number | null;
    lastOutputTokens: number | null;
    lastModel: string | null;
    guidance: string[];
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
        <CardTitle>OpenAI</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--acton-muted)]">API key present</dt>
            <dd>
              <YesNo value={snapshot.config.openaiKeyPresent} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Fallback model</dt>
            <dd>{snapshot.config.fallbackModel || "(none)"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Last successful request</dt>
            <dd>{snapshot.openai?.lastSuccessfulRequest ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Last failed request</dt>
            <dd>{snapshot.openai?.lastFailedRequest ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Last safe error code</dt>
            <dd>{snapshot.openai?.lastSafeErrorCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Last HTTP status</dt>
            <dd>{snapshot.openai?.lastHttpStatus ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Requests / rate-limits (1h)</dt>
            <dd>
              {snapshot.openai?.requestsLastHour ?? 0} /{" "}
              {snapshot.openai?.rateLimitErrorsLastHour ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Quota errors (24h)</dt>
            <dd>{snapshot.openai?.quotaErrorsLast24h ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Retries / duplicates prevented</dt>
            <dd>
              {snapshot.openai?.totalRetries ?? 0} / {snapshot.openai?.duplicatesPrevented ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Avg latency / last tokens</dt>
            <dd>
              {snapshot.openai?.averageLatencyMs ?? "—"}ms · in{" "}
              {snapshot.openai?.lastInputTokens ?? "—"} / out{" "}
              {snapshot.openai?.lastOutputTokens ?? "—"}
            </dd>
          </div>
        </dl>
        {snapshot.openai?.guidance && snapshot.openai.guidance.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
            {snapshot.openai.guidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
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
            Test lightweight OpenAI
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void run("test_dynamic_answer")}
          >
            Test normal Baxter answer
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void run("test_rate_limit_classification")}
          >
            Test rate-limit classification
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
