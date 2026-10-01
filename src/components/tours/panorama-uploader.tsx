"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TOUR_UPLOAD_CONCURRENCY } from "@/lib/tours/constants";
import { formatUploadBytes } from "@/lib/tours/signed-put";
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
  loaded: number;
  total: number;
  previewUrl: string | null;
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
  const [dragOver, setDragOver] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const previewUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  function patch(id: string, next: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  function cancel(id: string) {
    controllers.current.get(id)?.abort();
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
      loaded: 0,
      total: file.size,
      previewUrl: null,
    }));
    for (const row of incoming) controllers.current.set(row.id, new AbortController());
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
            signal: controllers.current.get(row.id)?.signal,
            onStage: (stage) => patch(row.id, { stage }),
            onProgress: (loaded, total) => patch(row.id, { loaded, total }),
            onPreview: (thumbnail) => {
              const url = URL.createObjectURL(thumbnail);
              previewUrls.current.push(url);
              patch(row.id, { previewUrl: url });
            },
          });
          if (result.cancelled) {
            setRows((current) => current.filter((item) => item.id !== row.id));
            return;
          }
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
      for (const row of incoming) controllers.current.delete(row.id);
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`block rounded-lg border border-dashed px-4 py-5 text-center ${
          dragOver
            ? "border-[var(--acton-yellow)] bg-[var(--acton-yellow)]/20"
            : "border-[var(--acton-border)] bg-[var(--acton-gray-50)]"
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void onFiles(takeInputFiles(event.dataTransfer.files));
        }}
      >
        <span className="text-sm font-semibold text-[var(--acton-navy)]">
          {dragOver
            ? "Drop panoramas"
            : busy
              ? "Uploading panoramas…"
              : "Add JPEG or PNG panoramas"}
        </span>
        <span className="mt-1 block text-xs text-[var(--acton-muted)]">
          Drop files here or choose them. Originals are stored unchanged. Up to three upload at
          once.
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
              <div className="flex items-center gap-3">
                {row.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.previewUrl} alt="" className="h-10 w-16 rounded object-cover" />
                ) : (
                  <div className="h-10 w-16 rounded bg-[var(--acton-gray-50)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-[var(--acton-navy)]">
                      {row.name}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                      {STAGE_LABEL[row.stage]}
                    </span>
                  </div>
                  {row.stage === "uploading" ? (
                    <p className="mt-1 text-xs text-[var(--acton-navy)]">
                      {formatUploadBytes(row.loaded, row.total || row.loaded)}
                    </p>
                  ) : null}
                </div>
                {row.stage === "queued" ||
                row.stage === "processing" ||
                row.stage === "uploading" ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-red-700"
                    onClick={() => cancel(row.id)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {row.stage === "uploading" && row.total > 0 ? (
                <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--acton-gray-50)]">
                  <div
                    className="h-full bg-[var(--acton-navy)]"
                    style={{
                      width: `${Math.min(100, Math.round((row.loaded / row.total) * 100))}%`,
                    }}
                  />
                </div>
              ) : null}
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
