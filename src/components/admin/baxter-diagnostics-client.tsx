"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type Snapshot = {
  config: {
    chatEnabled: boolean;
    provider: string;
    model: string;
    fallbackProvider?: string | null;
    fallbackModel?: string | null;
    embeddingProvider?: string;
    embeddingModel?: string;
    visionProvider?: string;
    visionModel?: string;
    propertyResearchAiProvider?: string;
    openaiKeyPresent: boolean;
    anthropicKeyPresent?: boolean;
    supabaseServiceRolePresent: boolean;
    googleConfigured: boolean;
    slackConfigured: boolean;
    runtimeVersion?: string;
    governanceVersion?: string;
    loadedStandards?: string[];
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
  knowledgeHealth?: {
    sources: number;
    approvedSources: number;
    indexedUnits: number;
    embeddingCoverage: { withEmbedding: number; embeddable: number; percent: number };
    structuredTables: number;
    spreadsheetRows: number;
    multimodalSources: number;
    indexFailures: number;
    lastReindexAt: string | null;
    lastEvaluationAt: string | null;
    evalPassRate: number | null;
    indexVersion: number;
  };
  governance?: {
    runtimeVersion: string;
    governanceVersion: string;
    openDecisionCount: number;
    unresolvedRiskCount: number;
    note: string;
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
  const [inspectQuestion, setInspectQuestion] = useState(
    "How much was the Lori Harris project agreement for?",
  );
  const [inspectResult, setInspectResult] = useState<string | null>(null);

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

  async function inspectRetrieval() {
    setBusy(true);
    setInspectResult(null);
    try {
      const response = await fetch("/api/admin/baxter/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect_retrieval", question: inspectQuestion }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setInspectResult(payload.error?.message ?? "Inspection failed");
      } else {
        setInspectResult(JSON.stringify(payload.result, null, 2));
      }
    } catch {
      setInspectResult("Inspection request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter diagnostics</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Admin-only health checks. Secret values and the full system prompt are never displayed.
        </p>
      </div>

      <Card>
        <CardTitle>Runtime</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--acton-muted)]">Runtime version</dt>
            <dd>v{snapshot.config.runtimeVersion ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Governance version</dt>
            <dd>
              v{snapshot.config.governanceVersion ?? snapshot.governance?.governanceVersion ?? "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--acton-muted)]">Canonical standards (runtime)</dt>
            <dd>{(snapshot.config.loadedStandards ?? []).join(", ") || "—"}</dd>
          </div>
          {snapshot.governance ? (
            <>
              <div>
                <dt className="text-[var(--acton-muted)]">Open governance decisions</dt>
                <dd>{snapshot.governance.openDecisionCount}</dd>
              </div>
              <div>
                <dt className="text-[var(--acton-muted)]">Unresolved risks</dt>
                <dd>{snapshot.governance.unresolvedRiskCount}</dd>
              </div>
              <div className="text-xs text-[var(--acton-muted)] sm:col-span-2">
                {snapshot.governance.note}{" "}
                <a
                  href="/admin/baxter/governance"
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  Open governance
                </a>
              </div>
            </>
          ) : null}
        </dl>
      </Card>

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
            <dt className="text-[var(--acton-muted)]">Reasoning provider</dt>
            <dd>
              {snapshot.config.provider} / {snapshot.config.model}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Fallback</dt>
            <dd>
              {snapshot.config.fallbackProvider
                ? `${snapshot.config.fallbackProvider} / ${snapshot.config.fallbackModel ?? "default"}`
                : "None"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Embedding</dt>
            <dd>
              {snapshot.config.embeddingProvider ?? "openai"} /{" "}
              {snapshot.config.embeddingModel ?? "text-embedding-3-small"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Vision</dt>
            <dd>
              {snapshot.config.visionProvider ?? "openai"} / {snapshot.config.visionModel ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Property Research AI</dt>
            <dd>{snapshot.config.propertyResearchAiProvider ?? "deterministic"}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">OpenAI key present</dt>
            <dd>
              <YesNo value={snapshot.config.openaiKeyPresent} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Anthropic key present</dt>
            <dd>
              <YesNo value={Boolean(snapshot.config.anthropicKeyPresent)} />
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
        {snapshot.knowledgeHealth ? (
          <dl className="mt-4 grid gap-2 border-t border-[var(--acton-border)] pt-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--acton-muted)]">Indexed units</dt>
              <dd>{snapshot.knowledgeHealth.indexedUnits}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Embedding coverage</dt>
              <dd>
                {snapshot.knowledgeHealth.embeddingCoverage.percent}% (
                {snapshot.knowledgeHealth.embeddingCoverage.withEmbedding}/
                {snapshot.knowledgeHealth.embeddingCoverage.embeddable})
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Structured tables / rows</dt>
              <dd>
                {snapshot.knowledgeHealth.structuredTables} /{" "}
                {snapshot.knowledgeHealth.spreadsheetRows}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Multimodal sources</dt>
              <dd>{snapshot.knowledgeHealth.multimodalSources}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Index failures</dt>
              <dd>{snapshot.knowledgeHealth.indexFailures}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Index version</dt>
              <dd>{snapshot.knowledgeHealth.indexVersion}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Last reindex</dt>
              <dd>
                {snapshot.knowledgeHealth.lastReindexAt
                  ? new Date(snapshot.knowledgeHealth.lastReindexAt).toLocaleString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Eval pass rate</dt>
              <dd>
                {snapshot.knowledgeHealth.evalPassRate != null
                  ? `${Math.round(snapshot.knowledgeHealth.evalPassRate * 100)}%`
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
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
        <CardTitle>Retrieval inspector</CardTitle>
        <CardDescription className="mt-2">
          Hybrid retrieval inspector: intent, structured/lexical/semantic matches, final ranking (no
          hidden chain-of-thought).
        </CardDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="min-w-[240px] flex-1 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
            value={inspectQuestion}
            onChange={(e) => setInspectQuestion(e.target.value)}
            aria-label="Question to inspect"
          />
          <Button disabled={busy} onClick={() => void inspectRetrieval()}>
            Inspect retrieval
          </Button>
        </div>
        {inspectResult ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs text-[var(--acton-navy)]">
            {inspectResult}
          </pre>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Built-in tests</CardTitle>
        <CardDescription className="mt-2">
          These call the real shared services (OpenAI only when configured).
        </CardDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run("test_primary_reasoning")}>
            Test primary reasoning
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void run("test_fallback_reasoning")}
          >
            Test fallback reasoning
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => void run("test_embeddings")}>
            Test embeddings
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => void run("test_vision")}>
            Test vision
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
