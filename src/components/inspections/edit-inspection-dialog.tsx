"use client";

import { useMemo, useState } from "react";
import { AddressAutocomplete } from "@/components/address/address-autocomplete";
import {
  InspectionProjectPicker,
  type ProjectPick,
} from "@/components/inspections/inspection-project-picker";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SelectedAddress } from "@/lib/address/types";
import type { SiteInspectionDetail, SiteInspectionSummary } from "@/lib/inspections/record-types";
import type { ExpenseJob } from "@/lib/receipts/types";

type Assignee = { id: string; displayName: string };

export function EditInspectionDialog({
  row,
  jobs,
  assignees,
  onClose,
  onSaved,
}: {
  row: SiteInspectionSummary;
  jobs: ExpenseJob[];
  assignees: Assignee[];
  onClose: () => void;
  onSaved: (inspection: SiteInspectionDetail) => void;
}) {
  const [projectName, setProjectName] = useState(row.projectName);
  const [addressQuery, setAddressQuery] = useState(row.address);
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null);
  const [assignedTo, setAssignedTo] = useState(row.assignedTo ?? "");
  const [jobId, setJobId] = useState<string | null>(row.jobId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = useMemo(() => {
    const address = (selectedAddress?.formattedAddress || addressQuery).trim();
    return (
      projectName.trim() !== row.projectName ||
      address !== row.address.trim() ||
      selectedAddress !== null ||
      (assignedTo || null) !== row.assignedTo ||
      jobId !== row.jobId
    );
  }, [addressQuery, assignedTo, jobId, projectName, row, selectedAddress]);

  function requestClose() {
    if (dirty) {
      setDiscardOpen(true);
      return false;
    }
    return true;
  }

  function onPick(pick: ProjectPick) {
    setProjectName(pick.projectName);
    setAddressQuery(pick.address);
    setSelectedAddress(null);
    setJobId(pick.kind === "job" ? pick.job.id : null);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!projectName.trim()) next.projectName = "Project name is required";
    if (!addressQuery.trim()) next.address = "Address is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    const address = (selectedAddress?.formattedAddress || addressQuery).trim();
    try {
      const res = await fetch(`/api/inspections/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim(),
          address,
          ...(selectedAddress
            ? { latitude: selectedAddress.latitude, longitude: selectedAddress.longitude }
            : {}),
          assignedTo: assignedTo || null,
          jobId,
        }),
      });
      const json = (await res.json()) as {
        inspection?: SiteInspectionDetail;
        error?: { message?: string };
      };
      if (!res.ok || !json.inspection) {
        throw new Error(json.error?.message ?? "Could not save inspection");
      }
      onSaved(json.inspection);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Could not save inspection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open onClose={onClose} onRequestClose={requestClose} size="md">
        <DialogHeader>
          <DialogTitle>Edit inspection</DialogTitle>
          <DialogDescription>
            Update the project name, address, or who this visit is assigned to.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <p className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
              Linked project
            </p>
            <InspectionProjectPicker jobs={jobs} onPick={onPick} disabled={busy} />
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Choosing a project fills in the name and address.
            </p>
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="edit-insp-name"
            >
              Project name <span className="text-red-600">*</span>
            </label>
            <Input
              id="edit-insp-name"
              className="min-h-11"
              value={projectName}
              aria-invalid={Boolean(errors.projectName)}
              disabled={busy}
              onChange={(event) => setProjectName(event.target.value)}
            />
            {errors.projectName ? (
              <p className="mt-1 text-sm text-red-700">{errors.projectName}</p>
            ) : null}
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="edit-insp-address"
            >
              Address <span className="text-red-600">*</span>
            </label>
            <AddressAutocomplete
              id="edit-insp-address"
              value={selectedAddress}
              query={addressQuery}
              onChange={setSelectedAddress}
              onQueryChange={setAddressQuery}
              disabled={busy}
              placeholder="Street, city"
              inputClassName="min-h-11"
            />
            {errors.address ? <p className="mt-1 text-sm text-red-700">{errors.address}</p> : null}
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="edit-insp-assignee"
            >
              Assign to (optional)
            </label>
            <select
              id="edit-insp-assignee"
              className="min-h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              value={assignedTo}
              disabled={busy}
              onChange={(event) => setAssignedTo(event.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.displayName}
                </option>
              ))}
            </select>
          </div>
          {serverError ? (
            <p role="alert" className="text-sm text-red-700">
              {serverError}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton />
          <Button type="button" className="min-h-11" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard unsaved changes?"
        description="You have edits that haven’t been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
