"use client";

/**
 * Field checklist runner — optimistic media + IndexedDB background upload queue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ReceiptImageProcessError } from "@/lib/receipts/client-image";
import { listPendingResponses, queuePendingResponse } from "@/lib/inspections/client-autosave";
import { flushPendingResponses } from "@/lib/inspections/response-sync";
import {
  countPendingForInspection,
  discardMediaUpload,
  enqueueInspectionMedia,
  retryMediaUpload,
  startMediaQueueDrain,
  subscribeMediaQueue,
  VIDEO_MAX_BYTES,
  VIDEO_WARN_MESSAGE,
  type MediaQueueSnapshot,
} from "@/lib/inspections/media-queue";
import type {
  SiteInspectionDetail,
  SiteInspectionMedia,
  SiteInspectionResponse,
  SiteInspectionUploadStatus,
  SubQuestionAnswer,
} from "@/lib/inspections/record-types";
import type { SnapshotItem, SnapshotSubQuestion } from "@/lib/inspections/snapshot";

type SaveState = "saved" | "pending" | "saving" | "error";

function responseMap(responses: SiteInspectionResponse[]) {
  return new Map(responses.map((r) => [r.snapshotItemId, r]));
}

function mergeMediaLists(
  serverMedia: SiteInspectionMedia[],
  localByClientId: Map<string, SiteInspectionMedia>,
): SiteInspectionMedia[] {
  const merged = new Map<string, SiteInspectionMedia>();
  for (const m of serverMedia) {
    const key = m.clientMediaId ?? m.id;
    const local = m.clientMediaId ? localByClientId.get(m.clientMediaId) : undefined;
    merged.set(key, {
      ...m,
      localPreviewUrl: local?.localPreviewUrl ?? m.localPreviewUrl ?? null,
    });
  }
  for (const [clientId, local] of localByClientId) {
    if (![...merged.values()].some((m) => m.clientMediaId === clientId)) {
      merged.set(clientId, local);
    }
  }
  return Array.from(merged.values());
}

export function InspectionRunnerClient({
  initialInspection,
  currentUserId,
  isAdmin,
}: {
  initialInspection: SiteInspectionDetail;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [inspection, setInspection] = useState(initialInspection);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [queueSnap, setQueueSnap] = useState<MediaQueueSnapshot>({
    pendingCount: 0,
    failedCount: 0,
    uploadingCount: 0,
    items: [],
  });
  const [exportModeHint, setExportModeHint] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const localMediaRef = useRef(new Map<string, SiteInspectionMedia>());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const defaults = Object.fromEntries(
      initialInspection.snapshot.sections.map((s) => [s.id, true]),
    );
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(`baxter.inspection.sections.${initialInspection.id}`);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Record<string, boolean>) };
    } catch {
      /* ignore */
    }
    return defaults;
  });

  const flushTimer = useRef<number | null>(null);
  const flushInFlight = useRef(false);
  const flushAgain = useRef(false);
  const responses = useMemo(() => responseMap(inspection.responses), [inspection.responses]);

  /**
   * Media complete/status acks may update media rows and cover — never rewrite
   * checklist responses from those payloads (local edits stay authoritative).
   */
  const applyServerMediaOnly = useCallback((server: SiteInspectionDetail) => {
    setInspection((prev) => ({
      ...prev,
      media: mergeMediaLists(server.media, localMediaRef.current),
      pendingMediaCount: server.pendingMediaCount,
      failedMediaCount: server.failedMediaCount,
      coverMediaId: server.coverMediaId,
      coverSignedUrl: server.coverSignedUrl,
      updatedAt: server.updatedAt,
    }));
  }, []);

  const persistSectionState = useCallback(
    (next: Record<string, boolean>) => {
      setOpenSections(next);
      try {
        window.localStorage.setItem(
          `baxter.inspection.sections.${inspection.id}`,
          JSON.stringify(next),
        );
      } catch {
        /* ignore */
      }
    },
    [inspection.id],
  );

  const flushPending = useCallback(async () => {
    if (flushInFlight.current) {
      flushAgain.current = true;
      return;
    }
    flushInFlight.current = true;
    flushAgain.current = false;
    try {
      if (!listPendingResponses(inspection.id).length) {
        setSaveState("saved");
        return;
      }
      setSaveState("saving");
      const result = await flushPendingResponses({
        inspectionId: inspection.id,
        saveItem: async (body) => {
          const res = await fetch(`/api/inspections/${inspection.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = (await res.json()) as {
            inspection?: SiteInspectionDetail;
            error?: { message?: string };
          };
          // Ack only — do not apply json.inspection responses (stale-write race).
          if (!res.ok || !json.inspection) {
            throw new Error(json.error?.message ?? "Save failed");
          }
        },
      });
      if (result === "saved") setSaveState("saved");
      else if (result === "error") setSaveState("error");
      else setSaveState("pending");
    } finally {
      flushInFlight.current = false;
      if (flushAgain.current) {
        flushAgain.current = false;
        window.setTimeout(() => void flushPending(), 0);
      }
    }
  }, [inspection.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void flushPending();
    }, 0);
    const onOnline = () => void flushPending();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [flushPending]);

  useEffect(() => {
    const unsub = subscribeMediaQueue((snap) => {
      setQueueSnap(snap);
      setInspection((prev) => {
        const nextMedia = prev.media.map((m) => {
          if (!m.clientMediaId) return m;
          const q = snap.items.find((i) => i.clientMediaId === m.clientMediaId);
          if (!q) return m;
          const uploadStatus: SiteInspectionUploadStatus =
            q.status === "uploaded"
              ? "ready"
              : q.status === "uploading"
                ? "uploading"
                : q.status === "failed"
                  ? "failed"
                  : "pending";
          return {
            ...m,
            uploadStatus,
            uploadProgress: q.progress,
          };
        });
        return { ...prev, media: nextMedia };
      });
    });
    const stopDrain = startMediaQueueDrain({
      onInspectionUpdate: (server) => {
        for (const m of server.media) {
          if (m.clientMediaId && m.uploadStatus === "ready") {
            const local = localMediaRef.current.get(m.clientMediaId);
            if (local?.localPreviewUrl) {
              URL.revokeObjectURL(local.localPreviewUrl);
            }
            localMediaRef.current.delete(m.clientMediaId);
          }
        }
        applyServerMediaOnly(server);
      },
    });
    return () => {
      unsub();
      stopDrain();
    };
  }, [applyServerMediaOnly]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queueSnap.pendingCount > 0 || queueSnap.failedCount > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [queueSnap.failedCount, queueSnap.pendingCount]);

  function scheduleFlush() {
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flushPending(), 400);
  }

  function patchItemLocally(
    snapshotItemId: string,
    patch: {
      isComplete?: boolean;
      notes?: string;
      answers?: Record<string, SubQuestionAnswer>;
    },
  ) {
    setInspection((prev) => {
      const existing = prev.responses.find((r) => r.snapshotItemId === snapshotItemId);
      const nextResponse: SiteInspectionResponse = existing
        ? {
            ...existing,
            isComplete: patch.isComplete ?? existing.isComplete,
            notes: patch.notes !== undefined ? patch.notes : existing.notes,
            answers: patch.answers ? { ...existing.answers, ...patch.answers } : existing.answers,
            updatedAt: new Date().toISOString(),
          }
        : {
            id: `local-${snapshotItemId}`,
            inspectionId: prev.id,
            snapshotItemId,
            isComplete: patch.isComplete ?? false,
            notes: patch.notes ?? "",
            answers: patch.answers ?? {},
            updatedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
      const others = prev.responses.filter((r) => r.snapshotItemId !== snapshotItemId);
      const responsesNext = [...others, nextResponse];
      const completed = responsesNext.filter((r) => r.isComplete).length;
      const status =
        prev.totalItemCount > 0 && completed >= prev.totalItemCount ? "complete" : "pending";
      return {
        ...prev,
        responses: responsesNext,
        completedItemCount: completed,
        status,
      };
    });

    queuePendingResponse(inspection.id, {
      snapshotItemId,
      isComplete: patch.isComplete,
      notes: patch.notes,
      answers: patch.answers,
      updatedAt: new Date().toISOString(),
    });
    setSaveState("pending");
    scheduleFlush();
  }

  async function onMediaSelected(snapshotItemId: string, file: File, mediaType: "photo" | "video") {
    try {
      if (mediaType === "video" && file.size > VIDEO_MAX_BYTES) {
        window.alert(VIDEO_WARN_MESSAGE);
        return;
      }
      const { clientMediaId, optimisticMedia } = await enqueueInspectionMedia({
        inspectionId: inspection.id,
        snapshotItemId,
        file,
        mediaType,
      });
      localMediaRef.current.set(clientMediaId, optimisticMedia);
      setInspection((prev) => ({
        ...prev,
        media: [...prev.media.filter((m) => m.clientMediaId !== clientMediaId), optimisticMedia],
        pendingMediaCount: prev.pendingMediaCount + 1,
      }));
    } catch (e) {
      const message =
        e instanceof ReceiptImageProcessError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not queue media";
      window.alert(message);
    }
  }

  async function onRetry(clientMediaId: string) {
    await retryMediaUpload(clientMediaId);
  }

  async function onDiscard(clientMediaId: string) {
    await discardMediaUpload(clientMediaId);
    localMediaRef.current.delete(clientMediaId);
    setInspection((prev) => ({
      ...prev,
      media: prev.media.filter((m) => m.clientMediaId !== clientMediaId),
      pendingMediaCount: Math.max(0, prev.pendingMediaCount - 1),
      failedMediaCount: Math.max(0, prev.failedMediaCount - 1),
    }));
  }

  async function onExport(mode: "full" | "photos") {
    setExportModeHint(null);
    try {
      const counts = await countPendingForInspection(inspection.id);
      if (counts.pending > 0 || counts.failed > 0) {
        const proceed = window.confirm(
          `${counts.pending} upload(s) still pending and ${counts.failed} failed. Export ready media anyway?`,
        );
        if (!proceed) return;
      }
      const res = await fetch(`/api/inspections/${inspection.id}/export?mode=${mode}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string };
        };
        const message = json.error?.message ?? "Export failed";
        if (
          message.toLowerCase().includes("photos only") ||
          message.toLowerCase().includes("download photos")
        ) {
          setExportModeHint(message);
        }
        window.alert(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${inspection.projectName.replace(/[^\w.-]+/g, "_").slice(0, 40) || "inspection"}-media.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function confirmSoftDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "Could not delete inspection");
      setConfirmDelete(false);
      router.push("/inspections");
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete inspection");
      setDeleteBusy(false);
    }
  }

  const canDelete = isAdmin || inspection.createdBy === currentUserId;

  const mediaByItem = useMemo(() => {
    const map = new Map<string, SiteInspectionMedia[]>();
    for (const m of inspection.media) {
      const list = map.get(m.snapshotItemId) ?? [];
      list.push(m);
      map.set(m.snapshotItemId, list);
    }
    return map;
  }, [inspection.media]);

  const pendingUploads = queueSnap.pendingCount;
  const failedUploads = queueSnap.failedCount;
  const failedQueueItems = queueSnap.items.filter(
    (i) => i.status === "failed" && i.inspectionId === inspection.id,
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 space-y-2 border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)]/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href="/inspections"
              className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
              onClick={(e) => {
                if (pendingUploads > 0 || failedUploads > 0) {
                  const ok = window.confirm(
                    `${pendingUploads} upload(s) pending, ${failedUploads} failed. Leave anyway?`,
                  );
                  if (!ok) e.preventDefault();
                }
              }}
            >
              ← Site Inspections
            </Link>
            <h2 className="truncate text-lg font-bold text-[var(--acton-navy)]">
              {inspection.projectName}
            </h2>
            <p className="truncate text-sm text-[var(--acton-muted)]">{inspection.address}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">
              {inspection.completedItemCount} of {inspection.totalItemCount} complete
            </p>
            <p
              className={`text-xs ${
                saveState === "saved"
                  ? "text-emerald-700"
                  : saveState === "error"
                    ? "text-red-700"
                    : "text-amber-800"
              }`}
            >
              {saveState === "saved"
                ? "All changes saved"
                : saveState === "saving"
                  ? "Saving…"
                  : saveState === "error"
                    ? "Save error — will retry"
                    : "Pending sync"}
            </p>
            {pendingUploads > 0 ? (
              <p className="text-xs font-medium text-amber-800">
                {pendingUploads} upload{pendingUploads === 1 ? "" : "s"} pending
              </p>
            ) : null}
            {failedUploads > 0 ? (
              <p className="text-xs font-medium text-red-700">
                {failedUploads} upload{failedUploads === 1 ? "" : "s"} failed
              </p>
            ) : null}
            <span
              className={`mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                inspection.status === "complete"
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {inspection.status === "complete" ? "Complete" : "Pending"}
            </span>
          </div>
        </div>
        {failedQueueItems.length ? (
          <div className="space-y-1 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-left text-xs text-red-900">
            {failedQueueItems.map((item) => (
              <div
                key={item.clientMediaId}
                className="flex flex-wrap items-start justify-between gap-2"
              >
                <p className="min-w-0 flex-1">
                  {item.mediaType === "video" ? "Video" : "Photo"}:{" "}
                  {item.lastError ?? "Upload failed"}
                </p>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 min-h-8 px-2 text-xs"
                    onClick={() => void onRetry(item.clientMediaId)}
                  >
                    Retry
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 min-h-8 px-2 text-xs text-red-800"
                    onClick={() => void onDiscard(item.clientMediaId)}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-10"
            onClick={() => void onExport("full")}
          >
            Download all media
          </Button>
          {exportModeHint ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-10"
              onClick={() => void onExport("photos")}
            >
              Download photos only
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-10 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
        {deleteError ? <p className="text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Remove this site inspection?"
        description={
          <>
            This removes “{inspection.projectName}” from Site Inspections, including all checklist
            responses, notes, and attached photos and videos. The record is soft-deleted so an admin
            can recover it if needed — it will no longer appear in lists, counts, or media exports.
          </>
        }
        confirmLabel="Remove inspection"
        destructive
        busy={deleteBusy}
        requireTypedPhrase="DELETE"
        onConfirm={() => void confirmSoftDelete()}
      />

      {inspection.snapshot.standaloneItems.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          response={responses.get(item.id)}
          media={mediaByItem.get(item.id) ?? []}
          onPatch={(patch) => patchItemLocally(item.id, patch)}
          onPhoto={(file) => void onMediaSelected(item.id, file, "photo")}
          onVideo={(file) => void onMediaSelected(item.id, file, "video")}
          onRetry={(clientMediaId) => void onRetry(clientMediaId)}
        />
      ))}

      {inspection.snapshot.sections.map((section) => {
        const open = openSections[section.id] !== false;
        return (
          <section
            key={section.id}
            className="overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm"
          >
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between gap-2 bg-[var(--acton-gray-50)] px-3 py-2 text-left"
              aria-expanded={open}
              onClick={() =>
                persistSectionState({
                  ...openSections,
                  [section.id]: !open,
                })
              }
            >
              <span className="text-sm font-semibold text-[var(--acton-navy)]">
                {open ? "▼" : "▶"} {section.title}
              </span>
              <span className="text-xs text-[var(--acton-muted)]">
                {section.items.filter((item) => responses.get(item.id)?.isComplete).length}/
                {section.items.length}
              </span>
            </button>
            {open ? (
              <div className="space-y-3 p-3">
                {section.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    response={responses.get(item.id)}
                    media={mediaByItem.get(item.id) ?? []}
                    onPatch={(patch) => patchItemLocally(item.id, patch)}
                    onPhoto={(file) => void onMediaSelected(item.id, file, "photo")}
                    onVideo={(file) => void onMediaSelected(item.id, file, "video")}
                    onRetry={(clientMediaId) => void onRetry(clientMediaId)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function mediaStatusLabel(m: SiteInspectionMedia): string | null {
  if (m.uploadStatus === "ready") return null;
  if (m.uploadStatus === "uploading") {
    const pct = m.uploadProgress != null ? ` ${Math.round(m.uploadProgress * 100)}%` : "";
    return `Uploading${pct}`;
  }
  if (m.uploadStatus === "failed") return "Failed — tap retry";
  return "Queued";
}

function ItemCard({
  item,
  response,
  media,
  onPatch,
  onPhoto,
  onVideo,
  onRetry,
}: {
  item: SnapshotItem;
  response?: SiteInspectionResponse;
  media: SiteInspectionMedia[];
  onPatch: (patch: {
    isComplete?: boolean;
    notes?: string;
    answers?: Record<string, SubQuestionAnswer>;
  }) => void;
  onPhoto: (file: File) => void;
  onVideo: (file: File) => void;
  onRetry: (clientMediaId: string) => void;
}) {
  const complete = Boolean(response?.isComplete);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`rounded-lg border p-3 ${
        complete ? "border-emerald-300 bg-emerald-50/40" : "border-[var(--acton-border)] bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="h-6 w-6 accent-[var(--acton-navy)]"
            checked={complete}
            onChange={(e) => onPatch({ isComplete: e.target.checked })}
            aria-label={`Mark ${item.title} complete`}
          />
        </label>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-semibold text-[var(--acton-navy)]">{item.title}</p>
            {item.isCoverPhotoSource ? (
              <p className="text-xs font-medium text-[var(--acton-muted)]">Cover photo source</p>
            ) : null}
          </div>

          {item.guideNotes ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/90 p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold text-amber-950">Guide notes</span>
                <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
                  Internal only
                </span>
              </div>
              <pre className="font-sans text-sm whitespace-pre-wrap text-amber-950">
                {item.guideNotes}
              </pre>
            </div>
          ) : null}

          {item.allowsMedia ? (
            <div className="space-y-2">
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPhoto(file);
                  e.target.value = "";
                }}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onVideo(file);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => photoRef.current?.click()}
                >
                  Attach photo
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => {
                    window.alert(VIDEO_WARN_MESSAGE);
                    videoRef.current?.click();
                  }}
                >
                  Attach video
                </Button>
              </div>
              {media.length ? (
                <div className="flex flex-wrap gap-2">
                  {media.map((m) => {
                    const src = m.localPreviewUrl || m.signedUrl;
                    const label = mediaStatusLabel(m);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="relative h-16 w-16 overflow-hidden rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)]"
                        onClick={() => {
                          if (m.uploadStatus === "failed" && m.clientMediaId) {
                            onRetry(m.clientMediaId);
                          }
                        }}
                        aria-label={label ?? "Media"}
                      >
                        {m.mediaType === "video" ? (
                          src ? (
                            <video src={src} className="h-full w-full object-cover" muted />
                          ) : (
                            <span className="flex h-full items-center justify-center text-[10px] text-[var(--acton-muted)]">
                              Video
                            </span>
                          )
                        ) : src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[10px] text-[var(--acton-muted)]">
                            …
                          </span>
                        )}
                        {label ? (
                          <span className="absolute inset-x-0 bottom-0 bg-black/65 px-0.5 py-0.5 text-[9px] leading-tight text-white">
                            {label}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {item.subQuestions.map((sq) => (
            <SubQuestionField
              key={sq.id}
              subQuestion={sq}
              answer={response?.answers?.[sq.id]}
              onChange={(value) =>
                onPatch({
                  answers: {
                    [sq.id]: { type: sq.questionType, value },
                  },
                })
              }
            />
          ))}

          {item.allowsNotes ? (
            <div>
              <label className="mb-1 block text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Notes
              </label>
              <textarea
                className="min-h-16 w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-base text-[var(--acton-navy)]"
                defaultValue={response?.notes ?? ""}
                key={`notes-${item.id}-${response?.updatedAt ?? "new"}`}
                placeholder="Add notes"
                onFocus={(e) => {
                  e.target.placeholder = "";
                }}
                onBlur={(e) => {
                  e.target.placeholder = "Add notes";
                  if (e.target.value !== (response?.notes ?? "")) {
                    onPatch({ notes: e.target.value });
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SubQuestionField({
  subQuestion,
  answer,
  onChange,
}: {
  subQuestion: SnapshotSubQuestion;
  answer?: SubQuestionAnswer;
  onChange: (value: string | string[] | null) => void;
}) {
  const value = answer?.value ?? null;

  if (subQuestion.questionType === "yes_no_na") {
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-[var(--acton-navy)]">
          {subQuestion.prompt}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(["yes", "no", "na"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`min-h-11 min-w-14 rounded-md border px-3 text-sm font-semibold ${
                value === opt
                  ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                  : "border-[var(--acton-border)] bg-white text-[var(--acton-navy)]"
              }`}
              onClick={() => onChange(opt)}
            >
              {opt === "na" ? "N/A" : opt === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  if (subQuestion.questionType === "single_select") {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
          {subQuestion.prompt}
        </label>
        <select
          className="min-h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-base"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Select…</option>
          {subQuestion.options.map((opt) => (
            <option key={opt.id} value={opt.label}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (subQuestion.questionType === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-[var(--acton-navy)]">
          {subQuestion.prompt}
        </legend>
        <div className="space-y-1">
          {subQuestion.options.map((opt) => {
            const checked = selected.includes(opt.label);
            return (
              <label
                key={opt.id}
                className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--acton-border)] px-3"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--acton-navy)]"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((v) => v !== opt.label)
                      : [...selected, opt.label];
                    onChange(next);
                  }}
                />
                <span className="text-sm text-[var(--acton-navy)]">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
        {subQuestion.prompt}
      </label>
      <Input
        className="min-h-11 text-base"
        defaultValue={typeof value === "string" ? value : ""}
        key={`text-${subQuestion.id}-${typeof value === "string" ? value : ""}`}
        placeholder="Type answer"
        onFocus={(e) => {
          e.target.placeholder = "";
        }}
        onBlur={(e) => {
          e.target.placeholder = "Type answer";
          onChange(e.target.value.trim() ? e.target.value : null);
        }}
      />
    </div>
  );
}
