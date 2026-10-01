"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TOUR_UPLOAD_CONCURRENCY } from "@/lib/tours/constants";
import { takeInputFiles } from "@/lib/tours/input-files";
import { mapWithConcurrency } from "@/lib/tours/pool";
import type { TourUploadStage } from "@/lib/tours/types";
import { uploadOnePanorama } from "@/lib/tours/upload-one";

type UploadRow = {
  id: string;
  name: string;
  stage: TourUploadStage;
  warning: string | null;
  error: string | null;
};

const STAGE_LABEL: Record<TourUploadStage, string> = {
  queued: "Queued",
  processing: "Processing",
  uploading: "Uploading",
  saving: "Saving",
  done: "Done",
  error: "Failed",
};

export function PanoramaUploader({ tourId }: { tourId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  function patch(id: string, next: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  async function onFiles(files: File[]) {
    if (!files.length) return;
    if (busy) {
      setBatchError("Wait for the current upload to finish, then choose the files again.");
      return;
    }
    setBatchError(null);
    const incoming: UploadRow[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      stage: "queued",
      warning: null,
      error: null,
    }));
    setRows((current) => [...incoming, ...current]);
    setBusy(true);
    try {
      const settled = await mapWithConcurrency(
        incoming,
        TOUR_UPLOAD_CONCURRENCY,
        async (row, index) => {
          const file = files[index];
          if (!file) {
            patch(row.id, { stage: "error", error: `${row.name}: The selected file was missing.` });
            return;
          }
          const result = await uploadOnePanorama({
            file,
            tourId,
            sceneId: row.id,
            onStage: (stage) => patch(row.id, { stage }),
          });
          patch(row.id, {
            warning: result.warning,
            error: result.error,
            ...(result.error ? { stage: "error" as const } : {}),
          });
        },
      );
      settled.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const row = incoming[index];
        if (!row) return;
        const reason = result.reason instanceof Error ? result.reason.message : "Upload failed.";
        patch(row.id, { stage: "error", error: `${row.name}: ${reason}` });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Upload failed.";
      setBatchError(reason);
      for (const row of incoming) {
        patch(row.id, { stage: "error", error: `${row.name}: ${reason}` });
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <label className="block rounded-lg border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-6 text-center">
        <span className="text-sm font-semibold text-[var(--acton-navy)]">
          {busy ? "Uploading panoramas…" : "Add JPEG or PNG panoramas"}
        </span>
        <span className="mt-1 block text-xs text-[var(--acton-muted)]">
          Original files are stored unchanged. Up to three upload at once.
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png"
          multiple
          disabled={busy}
          className="mt-3 block w-full text-sm text-[var(--acton-navy)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--acton-navy)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          onChange={(event) => {
            const selected = takeInputFiles(event.target.files);
            event.target.value = "";
            void onFiles(selected);
          }}
        />
      </label>
      {batchError ? (
        <p className="text-sm text-red-700" role="alert">
          {batchError}
        </p>
      ) : null}
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium text-[var(--acton-navy)]">{row.name}</span>
                <span className="shrink-0 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                  {STAGE_LABEL[row.stage]}
                </span>
              </div>
              {row.warning ? <p className="mt-1 text-xs text-amber-800">{row.warning}</p> : null}
              {row.error ? (
                <p className="mt-1 text-xs text-red-700" role="alert">
                  {row.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
