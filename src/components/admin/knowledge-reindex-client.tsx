"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function KnowledgeReindexClient({ currentVersion }: { currentVersion: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);

  async function rebuild() {
    setBusy(true);
    setError(null);
    setMessage("Rebuilding Knowledge Index…");
    setDetails(null);
    try {
      const response = await fetch("/api/admin/knowledge/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        summary?: {
          processed: number;
          unitsCreated: number;
          tablesDetected: number;
          rowsIndexed: number;
          failureCount: number;
        };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? "Reindex failed");
      const s = payload.summary!;
      setMessage(
        `Sources processed: ${s.processed}. Units created: ${s.unitsCreated}. Tables detected: ${s.tablesDetected}. Rows indexed: ${s.rowsIndexed}. Failures: ${s.failureCount}.`,
      );
      setDetails(JSON.stringify(payload, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reindex failed");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardTitle className="text-base">Rebuild Baxter index</CardTitle>
      <CardDescription className="mt-2">
        Rebuild document chunks and structured spreadsheet rows for retrieval. Current index
        version: <strong>{currentVersion}</strong>. Does not re-download Google files unless you
        sync separately — for Sheets, re-sync first so workbook grids are stored, then rebuild.
      </CardDescription>
      <div className="mt-4">
        <Button type="button" disabled={busy} onClick={() => void rebuild()}>
          {busy ? "Rebuilding Knowledge Index…" : "Rebuild Baxter index"}
        </Button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-emerald-800" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {details ? (
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--acton-gray-50)] p-2 text-xs">
          {details}
        </pre>
      ) : null}
    </Card>
  );
}
