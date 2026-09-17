"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExpenseJob } from "@/lib/receipts/types";

type Props = {
  initialJobs: ExpenseJob[];
};

export function ExpenseJobsAdminClient({ initialJobs }: Props) {
  const [jobs, setJobs] = useState<ExpenseJob[]>(initialJobs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const sorted = useMemo(
    () => [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [jobs],
  );

  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/expense-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as {
        jobs?: ExpenseJob[];
        job?: ExpenseJob;
        sync?: { upserted: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(payload.error?.message ?? "Request failed");
      }
      if (payload.jobs) setJobs(payload.jobs);
      else if (payload.job) {
        setJobs((prev) => {
          const idx = prev.findIndex((j) => j.id === payload.job!.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = payload.job!;
            return next;
          }
          return [...prev, payload.job!];
        });
      }
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/expense-jobs");
      const payload = (await res.json()) as { jobs?: ExpenseJob[]; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? "Failed to load");
      setJobs(payload.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = await post({
      action: "create_custom",
      job: { label: newLabel, isActive: true },
    });
    if (result) {
      setNewLabel("");
      setMessage("Custom job added.");
      await reload();
    }
  }

  async function handleSaveEdit(id: string) {
    const result = await post({
      action: "update",
      job: { id, label: editLabel },
    });
    if (result) {
      setEditId(null);
      setMessage("Job updated.");
    }
  }

  async function handleToggleActive(job: ExpenseJob) {
    await post({
      action: "update",
      job: { id: job.id, isActive: !job.isActive },
    });
  }

  async function handleMove(job: ExpenseJob, direction: -1 | 1) {
    const ids = sorted.map((j) => j.id);
    const index = ids.indexOf(job.id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    const tmp = next[index]!;
    next[index] = next[swap]!;
    next[swap] = tmp;
    await post({ action: "reorder", reorder: { orderedIds: next } });
  }

  async function handleSync() {
    const result = await post({ action: "sync_projects" });
    if (result?.sync) {
      setMessage(`Synced ${result.sync.upserted} project job(s) from Master Project Log.`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleSync()}>
          Refresh from Master Project Log
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void reload()}>
          Reload
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Custom job label (e.g. Office supplies)"
          className="min-h-11"
          required
        />
        <Button type="submit" disabled={busy || !newLabel.trim()}>
          Add custom job
        </Button>
      </form>

      <ul className="divide-y divide-[var(--acton-border)] rounded-md border border-[var(--acton-border)] bg-white">
        {sorted.map((job) => (
          <li key={job.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              {editId === job.id ? (
                <Input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="min-h-11"
                  autoFocus
                />
              ) : (
                <>
                  <p
                    className={`truncate text-sm font-medium ${job.isActive ? "text-[var(--acton-navy)]" : "text-[var(--acton-muted)] line-through"}`}
                  >
                    {job.label}
                  </p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {job.source === "project" ? `Project ${job.projectNumber ?? ""}` : "Custom"} ·
                    sort {job.sortOrder}
                    {!job.isActive ? " · hidden" : ""}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {editId === job.id ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleSaveEdit(job.id)}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditId(job.id);
                      setEditLabel(job.label);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleToggleActive(job)}
                  >
                    {job.isActive ? "Hide" : "Show"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleMove(job, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleMove(job, 1)}
                  >
                    Down
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
        {sorted.length === 0 ? (
          <li className="px-3 py-6 text-sm text-[var(--acton-muted)]">
            No jobs yet. Refresh from the Master Project Log or add a custom entry.
          </li>
        ) : null}
      </ul>

      <p className="text-sm text-[var(--acton-muted)]">
        Employees pick from active jobs on{" "}
        <Link href="/receipts" className="underline">
          /receipts
        </Link>
        . Hide and order survive Master Project Log refreshes.
      </p>
    </div>
  );
}
