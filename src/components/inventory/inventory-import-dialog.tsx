"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dollarsToCents } from "@/lib/inventory/build-com-parse";
import type { ImportDraft, ImportDraftLine } from "@/lib/inventory/import-types";
import { normalizeCustomJobLabel, shouldOfferCreateCustomJob } from "@/lib/receipts/job-select";
import { formatCentsAsDecimalDollars } from "@/lib/receipts/amount";

type Job = { id: string; label: string };

type EditableLine = ImportDraftLine & { key: string };

function reviewFlags(line: EditableLine): string[] {
  const flags: string[] = line.flags.filter((flag) => flag === "vision" || flag === "schema");
  if (!line.sku.trim()) flags.push("missing_sku");
  if (!line.quantity) flags.push("missing_quantity");
  if (
    line.quantity &&
    line.unitCostCents != null &&
    line.lineTotalCents != null &&
    line.quantity * line.unitCostCents !== line.lineTotalCents
  ) {
    flags.push("arithmetic_mismatch");
  }
  return flags;
}

function centsLabel(cents: number | null) {
  if (cents == null) return "";
  return formatCentsAsDecimalDollars(cents);
}

function blankLine(): EditableLine {
  return {
    key: `new-${Date.now()}`,
    itemName: "",
    sku: "",
    description: null,
    quantity: 1,
    unitCostCents: 0,
    lineTotalCents: 0,
    productUrl: null,
    photoStoragePath: null,
    photoUrl: null,
    source: "text",
    flags: [],
    pageNumber: 0,
  };
}

export function InventoryImportDialog({
  open,
  onClose,
  jobs,
}: {
  open: boolean;
  onClose: () => void;
  jobs: Job[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [customProjectLabel, setCustomProjectLabel] = useState("");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [costText, setCostText] = useState<Record<string, string>>({});
  const [vendor, setVendor] = useState("build.com");
  const [orderNumber, setOrderNumber] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"upload" | "review">("upload");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) => job.label.toLowerCase().includes(needle));
  }, [jobs, query]);
  const canCreate = shouldOfferCreateCustomJob(
    query,
    jobs.map((job) => job.label),
  );
  const projectReady = Boolean(jobId || customProjectLabel);
  const blocking = lines.some(
    (line) => !line.itemName.trim() || !line.sku.trim() || !line.quantity,
  );

  function applyDraft(next: ImportDraft) {
    setDraft(next);
    setVendor(next.vendor || "build.com");
    setOrderNumber(next.orderNumber ?? "");
    setAllowDuplicate(false);
    const nextLines = next.lines.map((line, index) => ({
      ...line,
      key: `${next.sha256}-${index}`,
    }));
    setLines(nextLines);
    setCostText(
      Object.fromEntries(nextLines.map((line) => [line.key, centsLabel(line.unitCostCents)])),
    );
    setPhase("review");
  }

  async function parsePdf() {
    if (!file) {
      setError("Choose a build.com order PDF");
      return;
    }
    if (!projectReady) {
      setError("Choose a project before parsing");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/inventory/import", { method: "POST", body });
      const payload = (await response.json()) as {
        status?: string;
        draft?: ImportDraft;
        jobId?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "Could not read that PDF");
        return;
      }
      if (payload.status === "pending" && payload.jobId) {
        const ready = await pollJob(payload.jobId);
        if (ready) applyDraft(ready);
        return;
      }
      if (payload.draft) applyDraft(payload.draft);
    } finally {
      setPending(false);
    }
  }

  async function pollJob(jobId: string): Promise<ImportDraft | null> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(
        `/api/inventory/import/status?jobId=${encodeURIComponent(jobId)}`,
      );
      const payload = (await response.json()) as {
        status?: string;
        draft?: ImportDraft;
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "Import status failed");
        return null;
      }
      if (payload.status === "failed") {
        setError(payload.message ?? "Import failed");
        return null;
      }
      if (payload.status === "ready" && payload.draft) return payload.draft;
    }
    setError("The PDF is still processing. Try the import again in a moment.");
    return null;
  }

  async function commit() {
    if (!draft) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sha256: draft.sha256,
          vendor,
          orderNumber: orderNumber.trim() || null,
          jobId: jobId || null,
          customProjectLabel: customProjectLabel || null,
          allowDuplicate,
          lines: lines.map((line) => ({
            itemName: line.itemName,
            sku: line.sku,
            description: line.description,
            quantity: line.quantity,
            unitCostCents: line.unitCostCents ?? 0,
            productUrl: line.productUrl,
            photoStoragePath: line.photoStoragePath,
          })),
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? "Import was not saved");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Import build.com order</DialogTitle>
        <DialogDescription>
          {phase === "review"
            ? "Nothing is saved until you import. Correct the rows first."
            : "Upload the order PDF, choose the project, then review every line before it is saved."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {phase === "upload" ? (
          <>
            <label className="block text-xs font-semibold">
              Order PDF
              <input
                aria-label="Order PDF"
                type="file"
                accept="application/pdf,.pdf"
                className="mt-1 block w-full text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="block text-xs font-semibold">
              Project
              <Input
                aria-label="Import project"
                className="mt-1"
                value={query}
                placeholder="Search the shared project list"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setJobId("");
                  setCustomProjectLabel("");
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
              />
            </label>
            {pickerOpen ? (
              <ul className="max-h-40 overflow-auto rounded-md border border-[var(--acton-border)] bg-white text-sm">
                {filtered.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-[var(--acton-gray-50)]"
                      onClick={() => {
                        setJobId(job.id);
                        setCustomProjectLabel("");
                        setQuery(job.label);
                        setPickerOpen(false);
                      }}
                    >
                      {job.label}
                    </button>
                  </li>
                ))}
                {canCreate ? (
                  <li>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left font-semibold"
                      onClick={() => {
                        const label = normalizeCustomJobLabel(query);
                        setCustomProjectLabel(label);
                        setJobId("");
                        setQuery(label);
                        setPickerOpen(false);
                      }}
                    >
                      + Create &quot;{normalizeCustomJobLabel(query)}&quot;
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold">
                Vendor
                <Input
                  aria-label="Import vendor"
                  value={vendor}
                  onChange={(event) => setVendor(event.target.value)}
                  className="mt-1"
                />
              </label>
              <label className="text-xs font-semibold">
                Order #
                <Input
                  aria-label="Import order number"
                  value={orderNumber}
                  onChange={(event) => setOrderNumber(event.target.value)}
                  className="mt-1"
                />
              </label>
            </div>
            <p className="text-xs text-[var(--acton-muted)]">
              Read from the PDF text layer
              {draft?.correctionAttempted ? " with a validation retry" : ""}.{" "}
              {draft?.source === "vision"
                ? "This PDF had no usable text layer, so rows came from vision — check every digit."
                : "Prices and SKUs were copied from the text, not guessed from a photo."}
            </p>
            {draft?.duplicate ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                This {draft.duplicate.match === "file" ? "PDF" : "order number"} was already
                imported
                {draft.duplicate.orderNumber ? ` as ${draft.duplicate.orderNumber}` : ""}. Importing
                again will add another copy.
                <label className="mt-2 flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={allowDuplicate}
                    onChange={(event) => setAllowDuplicate(event.target.checked)}
                  />
                  Import again anyway
                </label>
              </div>
            ) : null}
            <div className="max-h-[50vh] overflow-auto rounded-md border border-[var(--acton-border)]">
              <table className="w-full min-w-[40rem] text-left text-xs">
                <thead className="bg-[var(--acton-gray-50)] text-[var(--acton-navy)]">
                  <tr>
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1">Total</th>
                    <th className="px-2 py-1">Flags</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.key} className="border-t border-[var(--acton-border)] align-top">
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`Item ${index + 1}`}
                          value={line.itemName}
                          className="h-8"
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, itemName: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Finish ${index + 1}`}
                          value={line.description ?? ""}
                          className="mt-1 h-8"
                          placeholder="Finish"
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, description: event.target.value || null }
                                  : row,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Link ${index + 1}`}
                          value={line.productUrl ?? ""}
                          className="mt-1 h-8"
                          placeholder="Product link"
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, productUrl: event.target.value || null }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`SKU ${index + 1}`}
                          value={line.sku}
                          className="h-8"
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key ? { ...row, sku: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`Quantity ${index + 1}`}
                          value={line.quantity ?? ""}
                          className="h-8 w-16"
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? {
                                      ...row,
                                      quantity: Number.parseInt(event.target.value, 10) || null,
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`Unit cost ${index + 1}`}
                          value={costText[line.key] ?? centsLabel(line.unitCostCents)}
                          className="h-8 w-24"
                          onChange={(event) => {
                            const value = event.target.value;
                            const cents = dollarsToCents(value);
                            setCostText((current) => ({ ...current, [line.key]: value }));
                            if (cents == null) return;
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key ? { ...row, unitCostCents: cents } : row,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {line.quantity && line.unitCostCents != null
                          ? centsLabel(line.quantity * line.unitCostCents)
                          : centsLabel(line.lineTotalCents)}
                      </td>
                      <td className="px-2 py-1 text-amber-800">
                        {reviewFlags(line).includes("vision") ? "Vision " : ""}
                        {reviewFlags(line).includes("arithmetic_mismatch") ? "Math " : ""}
                        {reviewFlags(line).includes("missing_sku") ? "SKU " : ""}
                        {reviewFlags(line).includes("missing_quantity") ? "Qty" : ""}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            setLines((current) => current.filter((row) => row.key !== line.key))
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const line = blankLine();
                setLines((current) => [...current, line]);
                setCostText((current) => ({ ...current, [line.key]: "0.00" }));
              }}
            >
              Add row
            </Button>
          </>
        )}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {phase === "upload" ? (
          <Button type="button" disabled={pending} onClick={() => void parsePdf()}>
            {pending ? "Reading PDF…" : "Review lines"}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending || blocking || (Boolean(draft?.duplicate) && !allowDuplicate)}
            onClick={() => void commit()}
          >
            Import {lines.length} items
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
