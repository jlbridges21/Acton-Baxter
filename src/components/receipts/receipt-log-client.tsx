"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCentsAsUsd } from "@/lib/receipts/amount";
import { processReceiptImage, ReceiptImageProcessError } from "@/lib/receipts/client-image";
import { isLowConfidence, type ReceiptExtraction } from "@/lib/receipts/extraction-schema";
import type { ExpenseJob } from "@/lib/receipts/types";

export type ReceiptFormValues = {
  jobId: string;
  /** One-off label for this receipt only (xor with jobId). */
  customJobLabel: string;
  amount: string;
  vendor: string;
  purchasedOn: string;
  items: string;
  description: string;
  photoStoragePath?: string | null;
  extraction?: Record<string, unknown> | null;
};

type FieldKey = "amount" | "vendor" | "purchasedOn" | "items" | "description";

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyReceiptFormValues(overrides?: Partial<ReceiptFormValues>): ReceiptFormValues {
  return {
    jobId: "",
    customJobLabel: "",
    amount: "",
    vendor: "",
    purchasedOn: todayIsoDate(),
    items: "",
    description: "",
    photoStoragePath: null,
    extraction: null,
    ...overrides,
  };
}

type Props = {
  initialJobs: ExpenseJob[];
  initialValues?: Partial<ReceiptFormValues>;
  /** Admin/super_admin — shows Receipt Log entry inside PWA scope. */
  isAdmin?: boolean;
};

type Mode = "chooser" | "processing" | "extracting" | "manual" | "success";
type SubmitState = "idle" | "pending" | "success" | "error";
type ExtractBanner = "none" | "ok" | "empty" | "failed";

type DuplicateInfo = {
  id: string;
  vendor: string;
  amountCents: number;
  purchasedOn: string;
  createdAt: string;
};

export function ReceiptLogClient({ initialJobs, initialValues, isAdmin = false }: Props) {
  const [mode, setMode] = useState<Mode>(
    initialValues?.jobId ||
      initialValues?.customJobLabel ||
      initialValues?.amount ||
      initialValues?.vendor
      ? "manual"
      : "chooser",
  );
  const [jobs, setJobs] = useState(initialJobs);
  const [values, setValues] = useState<ReceiptFormValues>(() =>
    emptyReceiptFormValues(initialValues),
  );
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [processMessage, setProcessMessage] = useState<string | null>(null);
  const [lastAmountCents, setLastAmountCents] = useState<number | null>(null);
  const [lastJobLabel, setLastJobLabel] = useState<string | null>(null);
  const [jobQuery, setJobQuery] = useState(() => {
    if (initialValues?.customJobLabel) return initialValues.customJobLabel;
    const jobId = initialValues?.jobId;
    if (!jobId) return "";
    return initialJobs.find((j) => j.id === jobId)?.label ?? "";
  });
  const [jobOpen, setJobOpen] = useState(false);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [extractBanner, setExtractBanner] = useState<ExtractBanner>("none");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [fieldSource, setFieldSource] = useState<Partial<Record<FieldKey, "auto" | "edited">>>({});
  const [fieldConfidence, setFieldConfidence] = useState<Partial<Record<FieldKey, number>>>({});
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const duplicateDismissedRef = useRef(false);

  const jobListId = useId();
  const jobInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === values.jobId) ?? null,
    [jobs, values.jobId],
  );

  const selectedJobDisplay = selectedJob?.label || values.customJobLabel || null;

  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) => j.label.toLowerCase().includes(q) || (j.projectNumber ?? "").toLowerCase().includes(q),
    );
  }, [jobs, jobQuery]);

  const canCreateCustomJob =
    jobQuery.trim().length > 0 &&
    filteredJobs.length === 0 &&
    !values.jobId &&
    values.customJobLabel.trim().toLowerCase() !== jobQuery.trim().toLowerCase();

  const jobReady = Boolean(values.jobId || values.customJobLabel.trim());

  const patch = useCallback((partial: Partial<ReceiptFormValues>, editedKeys?: FieldKey[]) => {
    setValues((prev) => ({ ...prev, ...partial }));
    if (editedKeys?.length) {
      setFieldSource((prev) => {
        const next = { ...prev };
        for (const key of editedKeys) next[key] = "edited";
        return next;
      });
    }
    setSubmitState("idle");
    setError(null);
    duplicateDismissedRef.current = false;
  }, []);

  async function refreshJobs() {
    try {
      const res = await fetch("/api/receipts/jobs");
      const payload = (await res.json()) as { jobs?: ExpenseJob[] };
      if (res.ok && payload.jobs) setJobs(payload.jobs);
    } catch {
      // Keep existing list on soft failure
    }
  }

  function applyExtraction(
    extraction: ReceiptExtraction,
    prefill: {
      amount: string;
      vendor: string;
      purchasedOn: string;
      items: string;
      description: string;
    },
    storagePath: string,
  ) {
    const source: Partial<Record<FieldKey, "auto" | "edited">> = {};
    const confidence: Partial<Record<FieldKey, number>> = {
      amount: extraction.confidence.amount,
      vendor: extraction.confidence.vendor,
      purchasedOn: extraction.confidence.purchasedOn,
      items: extraction.confidence.items,
      description: extraction.confidence.description,
    };
    const next = emptyReceiptFormValues({
      jobId: values.jobId,
      customJobLabel: values.customJobLabel,
      amount: prefill.amount,
      vendor: prefill.vendor,
      purchasedOn: prefill.purchasedOn || todayIsoDate(),
      items: prefill.items,
      description: prefill.description,
      photoStoragePath: storagePath,
      extraction: extraction as unknown as Record<string, unknown>,
    });
    (["amount", "vendor", "purchasedOn", "items", "description"] as FieldKey[]).forEach((key) => {
      if (next[key]) source[key] = "auto";
    });
    setValues(next);
    setFieldSource(source);
    setFieldConfidence(confidence);
  }

  async function runExtract(storagePath: string, rotationDegrees?: 0 | 90 | 180 | 270) {
    setMode("extracting");
    setExtractError(null);
    setExtractBanner("none");
    try {
      const res = await fetch("/api/receipts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          ...(rotationDegrees != null ? { rotationDegrees } : {}),
        }),
      });
      const payload = (await res.json()) as {
        status?: "ok" | "empty" | "failed";
        error?: string | null;
        extraction?: ReceiptExtraction | null;
        prefill?: {
          amount: string;
          vendor: string;
          purchasedOn: string;
          items: string;
          description: string;
        } | null;
        rotationDegrees?: number;
        autoOriented?: boolean;
      };
      if (!res.ok) {
        throw new Error(
          (payload as { error?: { message?: string } }).error?.message ??
            "Extraction request failed",
        );
      }

      if (typeof payload.rotationDegrees === "number") {
        setPreviewRotation(((payload.rotationDegrees % 360) + 360) % 360);
      }

      if (payload.status === "ok" && payload.extraction && payload.prefill) {
        applyExtraction(payload.extraction, payload.prefill, storagePath);
        setExtractBanner("ok");
      } else if (payload.status === "empty" && payload.extraction) {
        setValues((prev) => ({
          ...prev,
          photoStoragePath: storagePath,
          extraction: payload.extraction as unknown as Record<string, unknown>,
        }));
        setFieldSource({});
        setFieldConfidence({});
        setExtractBanner("empty");
      } else {
        setValues((prev) => ({
          ...prev,
          photoStoragePath: storagePath,
          extraction: null,
        }));
        setExtractBanner("failed");
        setExtractError(payload.error ?? "Could not extract fields from this photo.");
      }
      setMode("manual");
      void refreshJobs();
    } catch (err) {
      setValues((prev) => ({
        ...prev,
        photoStoragePath: storagePath,
        extraction: null,
      }));
      setExtractBanner("failed");
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setMode("manual");
      void refreshJobs();
    }
  }

  async function handlePhotoSelected(file: File | null) {
    if (!file) return;
    setError(null);
    setProcessMessage(null);
    setExtractBanner("none");
    setExtractError(null);
    setDuplicate(null);
    setMode("processing");

    try {
      const processed = await processReceiptImage(file);
      setProcessMessage(
        `Compressed ${(processed.originalBytes / 1024).toFixed(0)}KB → ${(processed.processedBytes / 1024).toFixed(0)}KB`,
      );

      const body = new FormData();
      body.append("file", new File([processed.blob], "receipt.jpg", { type: "image/jpeg" }));

      const uploadRes = await fetch("/api/receipts/photo", { method: "POST", body });
      const uploadPayload = (await uploadRes.json()) as {
        storagePath?: string;
        signedUrl?: string | null;
        error?: { message?: string };
      };
      if (!uploadRes.ok || !uploadPayload.storagePath) {
        throw new Error(uploadPayload.error?.message ?? "Could not upload receipt photo");
      }

      if (uploadPayload.signedUrl) {
        setPhotoPreviewUrl(uploadPayload.signedUrl);
      } else {
        setPhotoPreviewUrl(URL.createObjectURL(processed.blob));
      }
      setPreviewRotation(0);

      setValues((prev) => ({
        ...prev,
        photoStoragePath: uploadPayload.storagePath!,
        extraction: null,
      }));

      // Upload-before-extract: photo is stored even if extraction fails.
      // Auto-orient runs on the server before field extraction.
      await runExtract(uploadPayload.storagePath);
    } catch (err) {
      const message =
        err instanceof ReceiptImageProcessError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not process photo";
      setError(message);
      setProcessMessage(null);
      // Fall through to manual entry without photo if upload never completed.
      setMode("manual");
      void refreshJobs();
    } finally {
      if (captureInputRef.current) captureInputRef.current.value = "";
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function checkDuplicate(): Promise<DuplicateInfo | null> {
    if (!values.vendor.trim() || !values.amount.trim()) return null;
    try {
      const params = new URLSearchParams({
        vendor: values.vendor.trim(),
        amount: values.amount.trim(),
      });
      const res = await fetch(`/api/receipts/duplicates?${params}`);
      const payload = (await res.json()) as { duplicate?: DuplicateInfo | null };
      if (res.ok) return payload.duplicate ?? null;
    } catch {
      // Soft fail — do not block submit
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitState("pending");
    setError(null);

    if (!duplicateDismissedRef.current) {
      const found = await checkDuplicate();
      if (found) {
        setDuplicate(found);
        setSubmitState("idle");
        return;
      }
    }

    const body = {
      jobId: values.jobId || null,
      customJobLabel: values.customJobLabel.trim() ? values.customJobLabel.trim() : null,
      amount: values.amount,
      vendor: values.vendor,
      purchasedOn: values.purchasedOn,
      items: values.items.trim() ? values.items.trim() : null,
      description: values.description.trim() ? values.description.trim() : null,
      photoStoragePath: values.photoStoragePath ?? null,
      extraction: values.extraction ?? null,
    };

    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as {
        receipt?: { amountCents: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(payload.error?.message ?? "Could not save expense");
      }
      setLastAmountCents(payload.receipt?.amountCents ?? null);
      setLastJobLabel(selectedJobDisplay);
      setSubmitState("success");
      setMode("success");
    } catch (err) {
      setSubmitState("error");
      setError(err instanceof Error ? err.message : "Could not save expense");
    }
  }

  function startAnother() {
    setValues(emptyReceiptFormValues());
    setJobQuery("");
    setLastAmountCents(null);
    setLastJobLabel(null);
    setError(null);
    setProcessMessage(null);
    setSubmitState("idle");
    setPhotoPreviewUrl(null);
    setExtractBanner("none");
    setExtractError(null);
    setFieldSource({});
    setFieldConfidence({});
    setDuplicate(null);
    duplicateDismissedRef.current = false;
    setMode("chooser");
    void refreshJobs();
  }

  function fieldHint(key: FieldKey): string | null {
    const source = fieldSource[key];
    const conf = fieldConfidence[key];
    if (source === "edited") return "Edited";
    if (source === "auto") {
      if (conf != null && isLowConfidence(conf)) return "Check — low confidence";
      return "Auto-filled";
    }
    return null;
  }

  function fieldClass(key: FieldKey): string {
    const hint = fieldHint(key);
    if (hint?.startsWith("Check")) {
      return "min-h-12 text-base border-amber-400 ring-1 ring-amber-300";
    }
    if (hint === "Auto-filled") {
      return "min-h-12 text-base border-sky-300";
    }
    if (hint === "Edited") {
      return "min-h-12 text-base border-emerald-400";
    }
    return "min-h-12 text-base";
  }

  if (mode === "success") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-5">
          <h1 className="text-xl font-semibold text-emerald-950">Expense logged</h1>
          <p className="mt-2 text-sm text-emerald-900">
            {lastAmountCents != null ? formatCentsAsUsd(lastAmountCents) : "Your expense"} was saved
            {lastJobLabel ? ` to ${lastJobLabel}` : ""}.
          </p>
        </div>
        <Button type="button" className="min-h-12 w-full text-base" onClick={startAnother}>
          Log another
        </Button>
      </div>
    );
  }

  if (mode === "processing" || mode === "extracting") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--acton-navy)] border-t-transparent"
          aria-hidden
        />
        <h1 className="text-xl font-semibold text-[var(--acton-navy)]">
          {mode === "processing" ? "Preparing photo…" : "Reading receipt…"}
        </h1>
        <p className="text-sm text-[var(--acton-muted)]">
          {mode === "processing"
            ? "Compressing and uploading securely. This usually takes a second."
            : "Correcting orientation, then extracting amount, vendor, and date."}
        </p>
        {processMessage ? (
          <p className="text-xs text-[var(--acton-muted)]">{processMessage}</p>
        ) : null}
      </div>
    );
  }

  if (mode === "chooser") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
        <header>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Log Expense</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Capture a job receipt in under 30 seconds.
          </p>
        </header>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            className="min-h-14 w-full justify-start text-base"
            onClick={() => captureInputRef.current?.click()}
          >
            Take photo of receipt
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-14 w-full justify-start text-base"
            onClick={() => uploadInputRef.current?.click()}
          >
            Upload photo of receipt
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-14 w-full justify-start text-base"
            onClick={() => {
              setMode("manual");
              void refreshJobs();
            }}
          >
            Enter manually
          </Button>
        </div>

        <div className="space-y-2 border-t border-[var(--acton-border)] pt-4">
          <a
            href="/receipts/mine"
            className="block text-sm font-medium text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            My Receipts
          </a>
          <p className="text-xs text-[var(--acton-muted)]">
            Review what you’ve already logged before capturing another.
          </p>
          {isAdmin ? (
            <a
              href="/receipts/log"
              className="mt-2 block text-sm font-medium text-[var(--acton-navy)] underline-offset-2 hover:underline"
            >
              Receipt Log
              <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">Admin</span>
            </a>
          ) : null}
        </div>
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          aria-label="Take photo of receipt"
          onChange={(e) => void handlePhotoSelected(e.target.files?.[0] ?? null)}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Upload photo of receipt"
          onChange={(e) => void handlePhotoSelected(e.target.files?.[0] ?? null)}
        />
        {error ? (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        <button
          type="button"
          className="text-sm text-[var(--acton-muted)]"
          onClick={() => setMode("chooser")}
        >
          ← Back
        </button>
        <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Log Expense</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          {values.photoStoragePath
            ? "Review extracted fields, edit anything, then submit."
            : "Manual entry — review and submit."}
        </p>
      </header>

      {photoPreviewUrl ? (
        <div className="mb-4">
          <div className="overflow-hidden rounded-md border border-[var(--acton-border)] bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed / blob URL preview */}
            <img
              src={photoPreviewUrl}
              alt="Receipt preview"
              className="mx-auto max-h-56 w-full object-contain transition-transform duration-200"
              style={{ transform: `rotate(${previewRotation}deg)` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => setPreviewRotation((r) => (r + 90) % 360)}
            >
              Rotate 90°
            </Button>
            {values.photoStoragePath ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={() =>
                  void runExtract(values.photoStoragePath!, previewRotation as 0 | 90 | 180 | 270)
                }
              >
                Re-extract at this orientation
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {extractBanner === "ok" ? (
        <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          Fields filled from the photo. Orientation is corrected automatically when needed —
          low-confidence values are highlighted. Edit freely or rotate below if something looks off.
        </p>
      ) : null}
      {extractBanner === "empty" ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Couldn’t read usable fields from this photo. Your photo is saved — fill the form manually.
        </p>
      ) : null}
      {extractBanner === "failed" ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            Extraction failed{extractError ? `: ${extractError}` : "."} Your photo is saved — fill
            fields manually or retry.
          </p>
          {values.photoStoragePath ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-2 min-h-11"
              onClick={() => void runExtract(values.photoStoragePath!)}
            >
              Retry extraction
            </Button>
          ) : null}
        </div>
      ) : null}

      {duplicate ? (
        <div
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-medium">Possible duplicate</p>
          <p className="mt-1">
            You already logged {formatCentsAsUsd(duplicate.amountCents)} at {duplicate.vendor} on{" "}
            {duplicate.purchasedOn}. You can still submit if this is a new receipt.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="min-h-11 flex-1"
              onClick={() => {
                duplicateDismissedRef.current = true;
                setDuplicate(null);
                const form = document.getElementById("receipt-form") as HTMLFormElement | null;
                form?.requestSubmit();
              }}
            >
              Submit anyway
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 flex-1"
              onClick={() => {
                setDuplicate(null);
                duplicateDismissedRef.current = false;
              }}
            >
              Go back
            </Button>
          </div>
        </div>
      ) : null}

      <form
        id="receipt-form"
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4"
        noValidate
      >
        <div className="relative">
          <label
            htmlFor={jobListId}
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
          >
            Job <span className="text-red-600">*</span>
          </label>
          {selectedJobDisplay ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--acton-navy)] bg-[var(--acton-gray-50)] px-3 py-2 text-sm font-medium text-[var(--acton-navy)]">
                <span className="truncate">{selectedJobDisplay}</span>
                {values.customJobLabel ? (
                  <span className="text-[10px] font-semibold tracking-wide text-amber-800 uppercase">
                    Custom
                  </span>
                ) : null}
                <button
                  type="button"
                  className="text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
                  aria-label="Clear job"
                  onClick={() => {
                    patch({ jobId: "", customJobLabel: "" });
                    setJobQuery("");
                    jobInputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ) : null}
          <Input
            id={jobListId}
            ref={jobInputRef}
            role="combobox"
            aria-expanded={jobOpen}
            aria-controls={`${jobListId}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search projects or type a one-off label"
            className="min-h-12 text-base"
            value={jobQuery}
            onChange={(e) => {
              setJobQuery(e.target.value);
              setJobOpen(true);
              if (values.jobId || values.customJobLabel) {
                patch({ jobId: "", customJobLabel: "" });
              }
            }}
            onFocus={() => setJobOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setJobOpen(false), 150);
            }}
          />
          {jobOpen ? (
            <ul
              id={`${jobListId}-list`}
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-[var(--acton-border)] bg-white shadow-md"
            >
              {filteredJobs.map((job) => (
                <li key={job.id} role="option" aria-selected={job.id === values.jobId}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      patch({ jobId: job.id, customJobLabel: "" });
                      setJobQuery(job.label);
                      setJobOpen(false);
                    }}
                  >
                    {job.label}
                  </button>
                </li>
              ))}
              {canCreateCustomJob ? (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="min-h-11 w-full border-t border-[var(--acton-border)] px-3 py-2 text-left text-sm font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const label = jobQuery.trim();
                      patch({ jobId: "", customJobLabel: label });
                      setJobQuery(label);
                      setJobOpen(false);
                    }}
                  >
                    + Create &ldquo;{jobQuery.trim()}&rdquo;
                    <span className="mt-0.5 block text-xs font-normal text-[var(--acton-muted)]">
                      For this receipt only — not added to the shared job list
                    </span>
                  </button>
                </li>
              ) : null}
              {filteredJobs.length === 0 && !canCreateCustomJob ? (
                <li className="px-3 py-3 text-sm text-[var(--acton-muted)]">
                  Type a name to create a one-off job label
                </li>
              ) : null}
            </ul>
          ) : null}
          {!jobReady && jobQuery.trim() ? (
            <p className="mt-1 text-xs text-amber-800">
              Select a job or create &ldquo;{jobQuery.trim()}&rdquo;
            </p>
          ) : null}
        </div>

        {(
          [
            {
              key: "amount" as const,
              label: "Amount",
              required: true,
              inputMode: "decimal" as const,
              placeholder: "$0.00",
              type: "text" as const,
            },
            {
              key: "vendor" as const,
              label: "Vendor",
              required: true,
              placeholder: "Store or vendor name",
              type: "text" as const,
              autoComplete: "organization",
            },
            {
              key: "purchasedOn" as const,
              label: "Date purchased",
              required: true,
              type: "date" as const,
            },
            {
              key: "items" as const,
              label: "Items",
              required: false,
              placeholder: "What was purchased",
              type: "text" as const,
            },
          ] as const
        ).map((field) => {
          const hint = fieldHint(field.key);
          return (
            <div key={field.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label
                  htmlFor={`receipt-${field.key}`}
                  className="block text-sm font-medium text-[var(--acton-navy)]"
                >
                  {field.label}{" "}
                  {field.required ? (
                    <span className="text-red-600">*</span>
                  ) : (
                    <span className="font-normal text-[var(--acton-muted)]">(optional)</span>
                  )}
                </label>
                {hint ? (
                  <span
                    className={`text-xs ${
                      hint.startsWith("Check")
                        ? "font-medium text-amber-800"
                        : hint === "Edited"
                          ? "text-emerald-800"
                          : "text-sky-800"
                    }`}
                  >
                    {hint}
                  </span>
                ) : null}
              </div>
              <Input
                id={`receipt-${field.key}`}
                type={field.type}
                inputMode={"inputMode" in field ? field.inputMode : undefined}
                autoComplete={"autoComplete" in field ? field.autoComplete : undefined}
                placeholder={"placeholder" in field ? field.placeholder : undefined}
                className={fieldClass(field.key)}
                value={values[field.key]}
                onChange={(e) => patch({ [field.key]: e.target.value }, [field.key])}
                required={field.required}
              />
            </div>
          );
        })}

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label
              htmlFor="receipt-description"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Description <span className="font-normal text-[var(--acton-muted)]">(optional)</span>
            </label>
            {fieldHint("description") ? (
              <span
                className={`text-xs ${
                  fieldHint("description")?.startsWith("Check")
                    ? "font-medium text-amber-800"
                    : fieldHint("description") === "Edited"
                      ? "text-emerald-800"
                      : "text-sky-800"
                }`}
              >
                {fieldHint("description")}
              </span>
            ) : null}
          </div>
          <textarea
            id="receipt-description"
            className={`min-h-24 w-full rounded-md border bg-white px-3 py-2 text-base text-[var(--acton-navy)] shadow-sm placeholder:text-[var(--acton-muted)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none ${
              fieldHint("description")?.startsWith("Check")
                ? "border-amber-400 ring-1 ring-amber-300"
                : fieldHint("description") === "Auto-filled"
                  ? "border-sky-300"
                  : fieldHint("description") === "Edited"
                    ? "border-emerald-400"
                    : "border-[var(--acton-border)]"
            }`}
            placeholder="Notes for accounting"
            value={values.description}
            onChange={(e) => patch({ description: e.target.value }, ["description"])}
          />
        </div>

        {error ? (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          className="min-h-12 w-full text-base"
          disabled={submitState === "pending" || !jobReady}
        >
          {submitState === "pending" ? "Saving…" : "Submit expense"}
        </Button>
      </form>

      {/* Keep file inputs mounted for retry from manual mode */}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden
        onChange={(e) => void handlePhotoSelected(e.target.files?.[0] ?? null)}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        onChange={(e) => void handlePhotoSelected(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
