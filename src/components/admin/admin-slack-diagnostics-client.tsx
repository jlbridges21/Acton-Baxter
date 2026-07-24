"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ActionResult = unknown;

export function AdminSlackDiagnosticsClient() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [testText, setTestText] = useState("");
  const [dryRunQuestion, setDryRunQuestion] = useState("Who is Baxter?");

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
