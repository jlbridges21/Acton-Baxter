"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KNOWLEDGE_SOURCE_TYPES, type KnowledgeSource } from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";

const FUTURE = [
  { name: "Google Drive", status: "Not connected" },
  { name: "GoHighLevel", status: "Not connected" },
  { name: "Buildertrend", status: "Not connected" },
  { name: "Domo", status: "Not connected" },
];

export function KnowledgeSourcesClient({ initialSources }: { initialSources: KnowledgeSource[] }) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<(typeof KNOWLEDGE_SOURCE_TYPES)[number]>("manual");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addSource() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/knowledge/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          source_type: sourceType,
          description: description || null,
          status: "manual",
        }),
      });
      const payload = (await response.json()) as {
        source?: KnowledgeSource;
        error?: { message?: string };
      };
      if (!response.ok || !payload.source)
        throw new Error(payload.error?.message ?? "Create failed");
      setSources((current) =>
        [...current, payload.source!].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(id: string, label: string) {
    if (!window.confirm(`Remove source “${label}”?`)) return;
    const response = await fetch(`/api/admin/knowledge/sources?id=${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Unable to remove source");
      return;
    }
    setSources((current) => current.filter((source) => source.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Knowledge Sources</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Track where Baxter knowledge comes from. Do not store API keys or secrets here.
        </p>
      </div>

      <Card>
        <CardTitle>Add manual source</CardTitle>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
          >
            {KNOWLEDGE_SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Input
            className="sm:col-span-2"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4">
          <Button
            type="button"
            disabled={busy || name.trim().length < 2}
            onClick={() => void addSource()}
          >
            Add source
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Configured sources</CardTitle>
        <div className="mt-4 divide-y divide-[var(--acton-border)]">
          {sources.length === 0 ? (
            <p className="py-3 text-sm text-[var(--acton-muted)]">No manual sources yet.</p>
          ) : (
            sources.map((source) => (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--acton-navy)]">{source.name}</p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {source.source_type} · {source.status}
                    {source.last_sync_at ? ` · last sync ${formatDate(source.last_sync_at)}` : ""}
                  </p>
                  {source.description ? (
                    <p className="mt-1 text-xs text-[var(--acton-muted)]">{source.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="gray">{source.status}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void removeSource(source.id, source.name)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="border-dashed">
        <CardTitle>Future integrations</CardTitle>
        <CardDescription className="mt-2">
          These systems are planned for later prompts and are not connected.
        </CardDescription>
        <div className="mt-4 space-y-2">
          {FUTURE.map((item) => (
            <div key={item.name} className="flex items-center justify-between text-sm">
              <span className="text-[var(--acton-navy)]">{item.name}</span>
              <Badge tone="gray">{item.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
