"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExpenseJob } from "@/lib/receipts/types";
import type { InspectionTemplateSummary } from "@/lib/inspections/types";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import {
  InspectionProjectPicker,
  type ProjectPick,
} from "@/components/inspections/inspection-project-picker";

type Assignee = { id: string; displayName: string };

export function InspectionsListClient({
  initialInspections,
  jobs,
  templates,
  assignees,
}: {
  initialInspections: SiteInspectionSummary[];
  jobs: ExpenseJob[];
  templates: InspectionTemplateSummary[];
  assignees: Assignee[];
}) {
  const router = useRouter();
  const [inspections, setInspections] = useState(initialInspections);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "complete">("all");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [assignedTo, setAssignedTo] = useState("");

  const visible = inspections.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.projectName.toLowerCase().includes(q) || row.address.toLowerCase().includes(q);
  });

  function onPick(pick: ProjectPick) {
    setProjectName(pick.projectName);
    setAddress(pick.address);
    setJobId(pick.kind === "job" ? pick.job.id : null);
  }

  async function createInspection() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          address,
          jobId,
          templateId,
          assignedTo: assignedTo || null,
        }),
      });
      const json = (await res.json()) as {
        inspection?: { id: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.inspection) {
        throw new Error(json.error?.message ?? "Could not create inspection");
      }
      router.push(`/inspections/${json.inspection.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create inspection");
      setBusy(false);
    }
  }

  async function refresh() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    const res = await fetch(`/api/inspections?${params.toString()}`);
    const json = (await res.json()) as { inspections?: SiteInspectionSummary[] };
    if (json.inspections) setInspections(json.inspections);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => void refresh()}
            placeholder="Search by project"
            className="min-h-11"
          />
          <select
            className="min-h-11 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)]"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
            }}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="complete">Complete</option>
          </select>
        </div>
        <Button type="button" className="min-h-11 shrink-0" onClick={() => setCreating((v) => !v)}>
          + Create New Site Inspection
        </Button>
      </div>

      {creating ? (
        <div className="space-y-3 rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
              Project
            </label>
            <InspectionProjectPicker jobs={jobs} onPick={onPick} disabled={busy} />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="insp-name"
            >
              Project name
            </label>
            <Input
              id="insp-name"
              className="min-h-11"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="insp-address"
            >
              Address <span className="text-red-600">*</span>
            </label>
            <Input
              id="insp-address"
              className="min-h-11"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="insp-template"
            >
              Template
            </label>
            <select
              id="insp-template"
              className="min-h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="insp-assignee"
            >
              Assign to (optional)
            </label>
            <select
              id="insp-assignee"
              className="min-h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              No email notification — track visits on the shared calendar.
            </p>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={busy || !projectName.trim() || !address.trim() || !templateId}
              onClick={() => void createInspection()}
            >
              {busy ? "Creating…" : "Create & open checklist"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((row) => (
          <li key={row.id}>
            <Link
              href={`/inspections/${row.id}`}
              className="relative block overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm transition hover:border-[var(--acton-navy)]"
            >
              <span
                className={`absolute top-2 right-2 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                  row.status === "complete"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {row.status === "complete" ? "Complete" : "Pending"}
              </span>
              <div className="aspect-[16/10] bg-[var(--acton-gray-50)]">
                {row.coverSignedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.coverSignedUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--acton-muted)]">
                    No cover photo yet
                  </div>
                )}
              </div>
              <div className="space-y-1 p-3 pr-20">
                <p className="truncate font-semibold text-[var(--acton-navy)]">{row.projectName}</p>
                <p className="truncate text-sm text-[var(--acton-muted)]">{row.address}</p>
                <p className="text-xs text-[var(--acton-muted)]">
                  {row.assignedToName ? `Assigned: ${row.assignedToName}` : "Unassigned"}
                </p>
                <p className="text-xs font-medium text-[var(--acton-navy)]">
                  {row.completedItemCount} of {row.totalItemCount} items
                </p>
                {row.pendingMediaCount > 0 ? (
                  <p className="text-xs font-medium text-amber-800">
                    {row.pendingMediaCount} upload{row.pendingMediaCount === 1 ? "" : "s"} pending
                  </p>
                ) : null}
                {row.failedMediaCount > 0 ? (
                  <p className="text-xs font-medium text-red-700">
                    {row.failedMediaCount} upload{row.failedMediaCount === 1 ? "" : "s"} failed
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="rounded-xl border border-dashed border-[var(--acton-border)] px-4 py-10 text-center text-sm text-[var(--acton-muted)] sm:col-span-2">
            No inspections match.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
