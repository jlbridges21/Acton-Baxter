"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectSyncStatus } from "@/components/admin/project-sync-status";
import { summarizeProjectJobSync } from "@/lib/receipts/project-sync-summary";
import { isSelectableExpenseJob, type ExpenseJob } from "@/lib/receipts/types";

type Props = {
  initialJobs: ExpenseJob[];
};

type JobFilter = "all" | "open" | "closed" | "unknown" | "custom";

const JOB_FILTERS: Array<{ id: JobFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "unknown", label: "Unknown" },
  { id: "custom", label: "Custom" },
];

function matchesFilter(job: ExpenseJob, filter: JobFilter): boolean {
  if (filter === "all") return true;
  if (filter === "custom") return job.source === "custom";
  return job.source === "project" && job.projectStatus === filter;
}

const STATUS_BADGE = {
  open: { label: "Open", tone: "green" },
  closed: { label: "Closed", tone: "gray" },
  unknown: { label: "Unknown", tone: "amber" },
} as const;

type SyncSummary = {
  upserted: number;
  added: number;
  updated: number;
  deactivatedMissing: number;
  statusCounts?: { open: number; closed: number; unknown: number };
};

export function ExpenseJobsAdminClient({ initialJobs }: Props) {
  const [jobs, setJobs] = useState<ExpenseJob[]>(initialJobs);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [filter, setFilter] = useState<JobFilter>("all");

  const sorted = useMemo(
    () => [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [jobs],
  );
  const visible = useMemo(
    () => sorted.filter((job) => matchesFilter(job, filter)),
    [sorted, filter],
  );
  const syncSummary = useMemo(() => summarizeProjectJobSync(jobs), [jobs]);
  const filterCounts = useMemo(() => {
    const counts: Record<JobFilter, number> = { all: 0, open: 0, closed: 0, unknown: 0, custom: 0 };
    for (const job of jobs) {
      for (const { id } of JOB_FILTERS) if (matchesFilter(job, id)) counts[id] += 1;
    }
    return counts;
  }, [jobs]);

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
        sync?: SyncSummary;
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
    // Swap with the neighbour the admin can see, even when a filter hides rows between them.
    const neighbour = visible[visible.findIndex((j) => j.id === job.id) + direction];
    if (!neighbour) return;
    const ids = sorted.map((j) => j.id);
    const index = ids.indexOf(job.id);
    const swap = ids.indexOf(neighbour.id);
    if (index < 0 || swap < 0) return;
    const next = [...ids];
    next[index] = neighbour.id;
    next[swap] = job.id;
    await post({ action: "reorder", reorder: { orderedIds: next } });
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await post({ action: "sync_projects" });
      if (result?.sync) {
        const { added, updated, deactivatedMissing, statusCounts } = result.sync;
        const parts = [`${added} job${added === 1 ? "" : "s"} added`, `${updated} updated`];
        if (statusCounts) {
          parts.push(
            `${statusCounts.open} Open, ${statusCounts.closed} Closed, ${statusCounts.unknown} Unknown`,
          );
        }
        if (deactivatedMissing > 0) {
          parts.push(`${deactivatedMissing} missing from the log marked Closed`);
        }
        setMessage(parts.join(", ") + ".");
      }
    } finally {
      setSyncing(false);
    }
  }

  const actionBusy = busy || syncing;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={actionBusy}
          onClick={() => void handleSync()}
        >
          {syncing ? "Refreshing…" : "Refresh from Master Project Log"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={actionBusy}
          onClick={() => void reload()}
        >
          Reload
        </Button>
      </div>

      <ProjectSyncStatus summary={syncSummary} />

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
      {syncing ? (
        <p className="text-sm text-[var(--acton-muted)]">
          Reading the Master Project Log — this can take several seconds…
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
        <Button type="submit" disabled={actionBusy || !newLabel.trim()}>
          Add custom job
        </Button>
      </form>

      <div
        role="group"
        aria-label="Filter jobs by status"
        className="flex flex-wrap gap-1 rounded-md border border-[var(--acton-border)] bg-white p-1"
      >
        {JOB_FILTERS.map(({ id, label }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(id)}
              className={`min-h-9 rounded px-3 text-sm font-medium ${
                active
                  ? "bg-[var(--acton-navy)] text-white"
                  : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
              }`}
            >
              {label}{" "}
              <span className={active ? "text-white/80" : "text-[var(--acton-muted)]"}>
                {filterCounts[id]}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="divide-y divide-[var(--acton-border)] rounded-md border border-[var(--acton-border)] bg-white">
        {visible.map((job) => (
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
                  <div className="flex min-w-0 items-center gap-2">
                    <p
                      className={`truncate text-sm font-medium ${job.isActive ? "text-[var(--acton-navy)]" : "text-[var(--acton-muted)] line-through"}`}
                    >
                      {job.label}
                    </p>
                    {job.source === "project" ? (
                      <Badge tone={STATUS_BADGE[job.projectStatus].tone} className="shrink-0">
                        {STATUS_BADGE[job.projectStatus].label}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {job.source === "project" ? `Project ${job.projectNumber ?? ""}` : "Custom"} ·
                    sort {job.sortOrder}
                    {!job.isActive ? " · hidden" : ""}
                    {!isSelectableExpenseJob(job, { allowClosed: true })
                      ? " · not offered in pickers"
                      : !isSelectableExpenseJob(job, { allowClosed: false })
                        ? " · Receipts and Inventory only"
                        : ""}
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
                    disabled={actionBusy}
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
                    disabled={actionBusy}
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
                    disabled={actionBusy}
                    onClick={() => void handleToggleActive(job)}
                  >
                    {job.isActive ? "Hide" : "Show"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={() => void handleMove(job, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={actionBusy}
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
        ) : visible.length === 0 ? (
          <li className="px-3 py-6 text-sm text-[var(--acton-muted)]">
            No jobs match this filter.
          </li>
        ) : null}
      </ul>

      <p className="text-sm text-[var(--acton-muted)]">
        Employees pick from active custom jobs and Open projects (Receipts and Inventory can also
        show Closed ones) on{" "}
        <Link href="/receipts" className="underline">
          /receipts
        </Link>
        , Site Inspections, and Inventory. Open/Closed comes from column J of the{" "}
        <Link href="/admin/baxter/projects" className="underline">
          Master Project Log
        </Link>
        . Hide and order survive Master Project Log refreshes.
      </p>
    </div>
  );
}
