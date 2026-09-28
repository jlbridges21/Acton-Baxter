"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { ExpenseJob } from "@/lib/receipts/types";
import type { InspectionTemplateSummary } from "@/lib/inspections/types";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import {
  InspectionProjectPicker,
  type ProjectPick,
} from "@/components/inspections/inspection-project-picker";
import { purgeMediaQueueForInspection } from "@/lib/inspections/media-queue";
import { InspectionAiPipelineProgress } from "@/components/inspections/inspection-ai-pipeline-progress";
import { AddressAutocomplete } from "@/components/address/address-autocomplete";
import type { SelectedAddress } from "@/lib/address/types";
import type { SiteInspectionListView } from "@/lib/inspections/view-preference";

type Assignee = { id: string; displayName: string };

export function InspectionsListClient({
  initialInspections,
  jobs,
  templates,
  assignees,
  currentUserId,
  isAdmin,
  view = "grid",
}: {
  initialInspections: SiteInspectionSummary[];
  jobs: ExpenseJob[];
  templates: InspectionTemplateSummary[];
  assignees: Assignee[];
  currentUserId: string;
  isAdmin: boolean;
  view?: SiteInspectionListView;
}) {
  const router = useRouter();
  const [inspections, setInspections] = useState(initialInspections);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "complete">("all");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SiteInspectionSummary | null>(null);

  const [projectName, setProjectName] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const activeTemplates = templates.filter((t) => !t.archivedAt);
  const [templateId, setTemplateId] = useState(activeTemplates[0]?.id ?? "");
  const [assignedTo, setAssignedTo] = useState("");

  const visible = inspections.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.projectName.toLowerCase().includes(q) || row.address.toLowerCase().includes(q);
  });

  function canDelete(row: SiteInspectionSummary) {
    return isAdmin || row.createdBy === currentUserId;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await purgeMediaQueueForInspection(deleteTarget.id);
      const res = await fetch(`/api/inspections/${deleteTarget.id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "Could not delete inspection");
      setInspections((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete inspection");
    } finally {
      setBusy(false);
    }
  }

  function onPick(pick: ProjectPick) {
    setProjectName(pick.projectName);
    setAddressQuery(pick.address);
    setSelectedAddress(null);
    setJobId(pick.kind === "job" ? pick.job.id : null);
  }

  async function createInspection() {
    setBusy(true);
    setError(null);
    const address = (selectedAddress?.formattedAddress || addressQuery).trim();
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          address,
          ...(selectedAddress
            ? { latitude: selectedAddress.latitude, longitude: selectedAddress.longitude }
            : {}),
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
            <AddressAutocomplete
              id="insp-address"
              value={selectedAddress}
              query={addressQuery}
              onChange={setSelectedAddress}
              onQueryChange={setAddressQuery}
              disabled={busy}
              placeholder="Street, city"
              inputClassName="min-h-11"
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
              {activeTemplates.map((t) => (
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
              disabled={busy || !projectName.trim() || !addressQuery.trim() || !templateId}
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

      {view === "list" ? (
        <InspectionListRows rows={visible} canDelete={canDelete} onDelete={setDeleteTarget} />
      ) : (
        <InspectionGrid rows={visible} canDelete={canDelete} onDelete={setDeleteTarget} />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove this site inspection?"
        description={
          deleteTarget ? (
            <>
              This removes “{deleteTarget.projectName}” from Site Inspections, including all
              checklist responses, notes, and attached photos and videos. The record is soft-deleted
              so an admin can recover it if needed — it will no longer appear in lists, counts, or
              media exports.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Remove inspection"
        destructive
        busy={busy}
        requireTypedPhrase="DELETE"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function assignedLabel(row: SiteInspectionSummary) {
  return row.assignedToName ? `Assigned: ${row.assignedToName}` : "Unassigned";
}

function progressLabel(row: SiteInspectionSummary) {
  return `${row.completedItemCount} of ${row.totalItemCount} items`;
}

function showAiProgress(row: SiteInspectionSummary) {
  return (
    row.aiProcessingStatus === "queued" ||
    row.aiProcessingStatus === "processing" ||
    row.aiProcessingStatus === "failed" ||
    (row.aiProcessingStatus === "complete" &&
      Boolean(row.aiProcessingMessage?.toLowerCase().includes("error")))
  );
}

function InspectionCover({
  row,
  compact = false,
}: {
  row: SiteInspectionSummary;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "relative h-12 w-16 shrink-0 overflow-hidden rounded bg-[var(--acton-gray-50)]"
          : "relative aspect-[16/10] bg-[var(--acton-gray-50)]"
      }
    >
      {row.coverSignedUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.coverSignedUrl}
            alt=""
            className={
              compact
                ? "block h-12 max-h-12 w-16 max-w-16 object-cover"
                : "h-full w-full object-cover"
            }
          />
          {row.coverSource === "street_view" ? (
            <span
              className={
                compact
                  ? "absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-center text-[8px] leading-tight font-medium text-white"
                  : "absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white"
              }
            >
              Street View
              {compact || !row.streetViewCapturedOn
                ? ""
                : ` · ${row.streetViewCapturedOn.slice(0, 4)}`}
            </span>
          ) : null}
        </>
      ) : (
        <div
          className={
            compact
              ? "flex h-full items-center justify-center px-0.5 text-center text-[8px] leading-tight text-[var(--acton-muted)]"
              : "flex h-full items-center justify-center text-xs text-[var(--acton-muted)]"
          }
        >
          No cover photo yet
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SiteInspectionSummary["status"] }) {
  const complete = status === "complete";
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
        complete ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {complete ? "Complete" : "Pending"}
    </span>
  );
}

function DeleteInspectionButton({
  row,
  onDelete,
  className,
}: {
  row: SiteInspectionSummary;
  onDelete: (row: SiteInspectionSummary) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={
        className ??
        "rounded-md border border-[var(--acton-border)] bg-white p-2 text-red-700 shadow-sm hover:bg-red-50"
      }
      aria-label={`Delete inspection ${row.projectName}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDelete(row);
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function UploadNotes({ row }: { row: SiteInspectionSummary }) {
  return (
    <>
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
    </>
  );
}

function AiProgress({ row }: { row: SiteInspectionSummary }) {
  if (!showAiProgress(row)) return null;
  return (
    <div
      className="pt-1"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <InspectionAiPipelineProgress
        key={`${row.id}-${row.aiProcessingStartedAt ?? row.aiProcessingStatus}`}
        inspection={row}
        inspectionId={row.id}
        compact
      />
    </div>
  );
}

function InspectionGrid({
  rows,
  canDelete,
  onDelete,
}: {
  rows: SiteInspectionSummary[];
  canDelete: (row: SiteInspectionSummary) => boolean;
  onDelete: (row: SiteInspectionSummary) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <Link
            href={`/inspections/${row.id}`}
            className="relative block overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm transition hover:border-[var(--acton-navy)]"
          >
            <span className="absolute top-2 right-2 z-10">
              <StatusBadge status={row.status} />
            </span>
            <InspectionCover row={row} />
            <div className="space-y-1 p-3 pr-20">
              <p className="truncate font-semibold text-[var(--acton-navy)]">{row.projectName}</p>
              <p className="truncate text-sm text-[var(--acton-muted)]">{row.address}</p>
              <p className="text-xs text-[var(--acton-muted)]">{assignedLabel(row)}</p>
              <p className="text-xs font-medium text-[var(--acton-navy)]">{progressLabel(row)}</p>
              <UploadNotes row={row} />
              <AiProgress row={row} />
            </div>
          </Link>
          {canDelete(row) ? (
            <DeleteInspectionButton
              row={row}
              onDelete={onDelete}
              className="absolute right-3 bottom-3 z-10 rounded-md border border-[var(--acton-border)] bg-white p-2 text-red-700 shadow-sm hover:bg-red-50"
            />
          ) : null}
        </li>
      ))}
      {rows.length === 0 ? (
        <li className="rounded-xl border border-dashed border-[var(--acton-border)] px-4 py-10 text-center text-sm text-[var(--acton-muted)] sm:col-span-2">
          No inspections match.
        </li>
      ) : null}
    </ul>
  );
}

function InspectionListRows({
  rows,
  canDelete,
  onDelete,
}: {
  rows: SiteInspectionSummary[];
  canDelete: (row: SiteInspectionSummary) => boolean;
  onDelete: (row: SiteInspectionSummary) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--acton-border)] px-4 py-10 text-center text-sm text-[var(--acton-muted)]">
        No inspections match.
      </p>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[5.5rem]" />
            <col />
            <col />
            <col />
            <col className="w-28" />
            <col className="w-36" />
            <col className="w-14" />
          </colgroup>
          <thead className="border-b border-[var(--acton-border)] text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="w-[5.5rem] max-w-[5.5rem] overflow-hidden py-2 pl-3 font-medium">
                <span className="sr-only">Thumbnail</span>
              </th>
              <th className="py-2 pr-3 font-medium">Project</th>
              <th className="py-2 pr-3 font-medium">Address</th>
              <th className="py-2 pr-3 font-medium">Assigned to</th>
              <th className="w-28 py-2 pr-3 font-medium">Status</th>
              <th className="w-36 py-2 pr-3 font-medium">Progress</th>
              <th className="w-14 py-2 pr-3 font-medium">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--acton-border)] last:border-0">
                <td className="w-[5.5rem] max-w-[5.5rem] overflow-hidden py-2 pl-3 align-middle">
                  <Link href={`/inspections/${row.id}`} className="block w-16 max-w-full">
                    <InspectionCover row={row} compact />
                  </Link>
                </td>
                <td className="max-w-0 overflow-hidden py-2 pr-3 align-middle">
                  <Link
                    href={`/inspections/${row.id}`}
                    className="block truncate font-semibold text-[var(--acton-navy)] hover:underline"
                  >
                    {row.projectName}
                  </Link>
                </td>
                <td className="max-w-0 truncate overflow-hidden py-2 pr-3 align-middle text-[var(--acton-muted)]">
                  {row.address}
                </td>
                <td className="max-w-0 truncate overflow-hidden py-2 pr-3 align-middle text-[var(--acton-muted)]">
                  {row.assignedToName ?? "Unassigned"}
                </td>
                <td className="w-28 overflow-hidden py-2 pr-3 align-middle">
                  <StatusBadge status={row.status} />
                </td>
                <td className="w-36 overflow-hidden py-2 pr-3 align-middle text-xs font-medium text-[var(--acton-navy)]">
                  <p className="truncate">{progressLabel(row)}</p>
                  <UploadNotes row={row} />
                </td>
                <td className="w-14 overflow-hidden py-2 pr-2 align-middle">
                  {canDelete(row) ? <DeleteInspectionButton row={row} onDelete={onDelete} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-2 overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white p-2 shadow-sm"
          >
            <Link href={`/inspections/${row.id}`} className="flex min-w-0 flex-1 items-start gap-3">
              <span className="block h-12 w-16 shrink-0 overflow-hidden">
                <InspectionCover row={row} compact />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-semibold text-[var(--acton-navy)]">
                  {row.projectName}
                </p>
                <p className="truncate text-xs text-[var(--acton-muted)]">{row.address}</p>
                <p className="truncate text-xs text-[var(--acton-muted)]">{assignedLabel(row)}</p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <StatusBadge status={row.status} />
                  <span className="text-xs font-medium text-[var(--acton-navy)]">
                    {progressLabel(row)}
                  </span>
                </div>
                <UploadNotes row={row} />
              </div>
            </Link>
            {canDelete(row) ? (
              <DeleteInspectionButton
                row={row}
                onDelete={onDelete}
                className="shrink-0 rounded-md border border-[var(--acton-border)] bg-white p-2 text-red-700"
              />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
