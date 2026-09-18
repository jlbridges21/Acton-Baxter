/**
 * Persistent background upload queue for site inspection media.
 * Blobs + metadata live in IndexedDB so uploads survive reload / backgrounding.
 */

import { Upload as TusUpload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { getPublicEnv } from "@/lib/env.public";
import { processReceiptImage, ReceiptImageProcessError } from "@/lib/receipts/client-image";
import { MEDIA_UPLOAD_CONCURRENCY, VIDEO_MAX_BYTES, VIDEO_WARN_MESSAGE } from "./media-limits";
import type { SiteInspectionDetail, SiteInspectionMedia } from "./record-types";

const DB_NAME = "baxter-site-inspection-uploads";
const DB_VERSION = 1;
const STORE = "queue";
/** Supabase TUS requires exactly 6 MiB chunks — any other value fails. */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_ATTEMPTS = 8;
const TUS_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export type QueueItemStatus = "queued" | "uploading" | "uploaded" | "failed";

export type MediaQueueItem = {
  clientMediaId: string;
  inspectionId: string;
  snapshotItemId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  byteSize: number;
  blob: Blob;
  status: QueueItemStatus;
  attempts: number;
  nextAttemptAt: number;
  progress: number;
  lastError: string | null;
  storagePath: string | null;
  createdAt: number;
};

export type MediaQueueSnapshot = {
  pendingCount: number;
  failedCount: number;
  uploadingCount: number;
  items: Array<{
    clientMediaId: string;
    inspectionId: string;
    snapshotItemId: string;
    mediaType: "photo" | "video";
    status: QueueItemStatus;
    progress: number;
    lastError: string | null;
  }>;
};

type PrepareResponse = {
  media: SiteInspectionMedia;
  upload:
    | { mode: "signed"; path: string; token: string; signedUrl: string }
    | { mode: "tus"; path: string; bucket: string; tusEndpoint: string }
    | { mode: "memory"; path: string };
};

type Listener = (snapshot: MediaQueueSnapshot) => void;
type InspectionUpdateHandler = (inspection: SiteInspectionDetail) => void;
type QueueListener = { fn: Listener; inspectionId: string | null };

let dbPromise: Promise<IDBDatabase> | null = null;
let draining = false;
let activeUploads = 0;
const listeners = new Set<QueueListener>();
const inFlight = new Set<string>();
/** clientMediaIds the user cancelled — processOne must not re-queue or patch failed. */
const cancelledUploads = new Set<string>();
/** Abort hooks for in-flight TUS (and any future transport) uploads. */
const activeAbortByClientId = new Map<string, () => void>();
let inspectionUpdateHandler: InspectionUpdateHandler | undefined;
let onlineBound = false;

/** In-memory queue for unit tests (IndexedDB unavailable / deterministic). */
let memoryQueue: Map<string, MediaQueueItem> | null = null;

export function resetMediaQueueMemoryForTests(): void {
  memoryQueue = new Map();
  dbPromise = null;
  draining = false;
  activeUploads = 0;
  listeners.clear();
  inFlight.clear();
  cancelledUploads.clear();
  activeAbortByClientId.clear();
  inspectionUpdateHandler = undefined;
  onlineBound = false;
}

export function enableMemoryMediaQueueForTests(): void {
  if (!memoryQueue) memoryQueue = new Map();
}

function openDb(): Promise<IDBDatabase> {
  if (memoryQueue) {
    return Promise.reject(new Error("IndexedDB bypassed — using memory queue"));
  }
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "clientMediaId" });
          store.createIndex("inspectionId", "inspectionId", { unique: false });
          store.createIndex("status", "status", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function putItem(item: MediaQueueItem): Promise<void> {
  if (memoryQueue) {
    memoryQueue.set(item.clientMediaId, item);
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE).put(item));
}

async function getItem(clientMediaId: string): Promise<MediaQueueItem | undefined> {
  if (memoryQueue) {
    return memoryQueue.get(clientMediaId);
  }
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return idbReq(tx.objectStore(STORE).get(clientMediaId));
}

async function deleteItem(clientMediaId: string): Promise<void> {
  if (memoryQueue) {
    memoryQueue.delete(clientMediaId);
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE).delete(clientMediaId));
}

async function listAllItems(): Promise<MediaQueueItem[]> {
  if (memoryQueue) {
    return Array.from(memoryQueue.values());
  }
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return idbReq(tx.objectStore(STORE).getAll());
}

function filterItemsForInspection(
  items: MediaQueueItem[],
  inspectionId: string | null | undefined,
): MediaQueueItem[] {
  if (!inspectionId) return items;
  return items.filter((item) => item.inspectionId === inspectionId);
}

function toSnapshot(items: MediaQueueItem[]): MediaQueueSnapshot {
  let pendingCount = 0;
  let failedCount = 0;
  let uploadingCount = 0;
  for (const item of items) {
    if (item.status === "queued") pendingCount += 1;
    if (item.status === "uploading") {
      pendingCount += 1;
      uploadingCount += 1;
    }
    if (item.status === "failed") failedCount += 1;
  }
  return {
    pendingCount,
    failedCount,
    uploadingCount,
    items: items.map((item) => ({
      clientMediaId: item.clientMediaId,
      inspectionId: item.inspectionId,
      snapshotItemId: item.snapshotItemId,
      mediaType: item.mediaType,
      status: item.status,
      progress: item.progress,
      lastError: item.lastError,
    })),
  };
}

async function emit(): Promise<void> {
  const items = await listAllItems();
  for (const listener of listeners) {
    listener.fn(toSnapshot(filterItemsForInspection(items, listener.inspectionId)));
  }
}

/**
 * Subscribe to queue snapshots. Pass `inspectionId` to receive only that
 * inspection's counts/items — global (unscoped) UI was leaking deleted-inspection failures.
 */
export function subscribeMediaQueue(
  listener: Listener,
  options?: { inspectionId?: string },
): () => void {
  const entry: QueueListener = { fn: listener, inspectionId: options?.inspectionId ?? null };
  listeners.add(entry);
  void listAllItems().then((items) => {
    listener(toSnapshot(filterItemsForInspection(items, entry.inspectionId)));
  });
  return () => listeners.delete(entry);
}

export async function getMediaQueueSnapshot(inspectionId?: string): Promise<MediaQueueSnapshot> {
  const items = await listAllItems();
  return toSnapshot(filterItemsForInspection(items, inspectionId));
}

export async function countPendingForInspection(inspectionId: string): Promise<{
  pending: number;
  failed: number;
}> {
  const items = (await listAllItems()).filter((i) => i.inspectionId === inspectionId);
  let pending = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "queued" || item.status === "uploading") pending += 1;
    if (item.status === "failed") failed += 1;
  }
  return { pending, failed };
}

/** Test helper: peek all persisted queue rows (including blobs' byte sizes). */
export async function listMediaQueueItemsForTests(): Promise<
  Array<{
    clientMediaId: string;
    inspectionId: string;
    status: QueueItemStatus;
    byteSize: number;
    hasBlob: boolean;
  }>
> {
  const items = await listAllItems();
  return items.map((item) => ({
    clientMediaId: item.clientMediaId,
    inspectionId: item.inspectionId,
    status: item.status,
    byteSize: item.byteSize,
    hasBlob: item.blob.size > 0 || item.byteSize > 0,
  }));
}

/**
 * Remove every queue entry (and blob) for one inspection — used on delete and
 * confirmed leave. Cancels in-flight TUS so drain cannot resurrect them.
 */
export async function purgeMediaQueueForInspection(inspectionId: string): Promise<number> {
  const items = (await listAllItems()).filter((i) => i.inspectionId === inspectionId);
  for (const item of items) {
    await cancelAndDiscardMediaUpload(item.clientMediaId);
  }
  await emit();
  return items.length;
}

/**
 * Drop queue entries whose inspection id is not in the known-accessible set
 * (soft-deleted / never existed / no access). Clears pre-deploy zombie failures.
 */
export async function purgeOrphanMediaQueueEntries(
  knownInspectionIds: ReadonlySet<string> | readonly string[],
): Promise<number> {
  const known =
    knownInspectionIds instanceof Set ? knownInspectionIds : new Set(knownInspectionIds);
  const items = await listAllItems();
  let removed = 0;
  for (const item of items) {
    if (!known.has(item.inspectionId)) {
      await cancelAndDiscardMediaUpload(item.clientMediaId);
      removed += 1;
    }
  }
  if (removed) await emit();
  return removed;
}

function isInspectionGoneStatus(status: number): boolean {
  return status === 404 || status === 410;
}

function isInspectionGoneMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("deleted") ||
    m.includes("no longer available") ||
    m.includes("inspection not found")
  );
}

function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempts, 8));
}

function formatUploadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Upload failed";
}

async function patchServerStatus(
  inspectionId: string,
  clientMediaId: string,
  uploadStatus: "pending" | "uploading" | "ready" | "failed",
  uploadProgress?: number | null,
): Promise<SiteInspectionDetail | null> {
  try {
    const res = await fetch(`/api/inspections/${inspectionId}/media/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientMediaId, uploadStatus, uploadProgress }),
    });
    const json = (await res.json()) as { inspection?: SiteInspectionDetail };
    return json.inspection ?? null;
  } catch (error) {
    console.warn("[site-inspection-media] status patch failed", {
      inspectionId,
      clientMediaId,
      uploadStatus,
      error: formatUploadError(error),
    });
    return null;
  }
}

async function uploadSigned(path: string, token: string, blob: Blob, mimeType: string) {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from("site-inspection-media")
    .uploadToSignedUrl(path, token, blob, { contentType: mimeType, upsert: true });
  if (error) throw new Error(error.message || "Signed upload failed");
}

async function uploadMemory(inspectionId: string, path: string, blob: Blob, mimeType: string) {
  const form = new FormData();
  form.set("path", path);
  form.set("file", new File([blob], "upload.bin", { type: mimeType }));
  const res = await fetch(`/api/inspections/${inspectionId}/media/bytes`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? "Memory upload failed");
  }
}

async function resolveAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in again to upload video");
  }
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs && expiresAtMs - Date.now() < 60_000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      throw new Error("Session expired — sign in again to finish the video upload");
    }
    return data.session.access_token;
  }
  return session.access_token;
}

function uploadTus(input: {
  clientMediaId: string;
  blob: Blob;
  path: string;
  bucket: string;
  tusEndpoint: string;
  mimeType: string;
  onProgress: (ratio: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let upload: TusUpload | null = null;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        activeAbortByClientId.delete(input.clientMediaId);
        fn();
      };
      try {
        let accessToken = await resolveAccessToken();
        const env = getPublicEnv();
        upload = new TusUpload(input.blob, {
          endpoint: input.tusEndpoint,
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            "x-upsert": "true",
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: TUS_CHUNK_SIZE_BYTES,
          metadata: {
            bucketName: input.bucket,
            objectName: input.path,
            contentType: input.mimeType,
            cacheControl: "3600",
          },
          onBeforeRequest: async (req) => {
            try {
              accessToken = await resolveAccessToken();
              req.setHeader("Authorization", `Bearer ${accessToken}`);
              req.setHeader("apikey", env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
              req.setHeader("x-upsert", "true");
            } catch (error) {
              settle(() =>
                reject(error instanceof Error ? error : new Error(formatUploadError(error))),
              );
            }
          },
          onShouldRetry: (err, _retryAttempt, _options) => {
            if (cancelledUploads.has(input.clientMediaId)) return false;
            const status = (
              err as { originalResponse?: { getStatus?: () => number } }
            ).originalResponse?.getStatus?.();
            if (status === 401 || status === 403) {
              console.warn(
                "[site-inspection-media] TUS auth failure — will refresh token and retry",
                {
                  status,
                  message: err.message,
                },
              );
              return true;
            }
            return true;
          },
          onError: (error) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (cancelledUploads.has(input.clientMediaId)) {
              settle(() => reject(new DOMException("Upload cancelled", "AbortError")));
              return;
            }
            const message = formatUploadError(error);
            console.error("[site-inspection-media] TUS upload failed", {
              path: input.path,
              message,
            });
            settle(() => reject(new Error(message)));
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            if (bytesTotal > 0) input.onProgress(bytesUploaded / bytesTotal);
          },
          onSuccess: () => {
            if (timeoutId) clearTimeout(timeoutId);
            settle(() => resolve());
          },
        });
        activeAbortByClientId.set(input.clientMediaId, () => {
          try {
            upload?.abort(true);
          } catch {
            /* ignore */
          }
          if (timeoutId) clearTimeout(timeoutId);
          settle(() => reject(new DOMException("Upload cancelled", "AbortError")));
        });
        timeoutId = setTimeout(() => {
          try {
            upload?.abort(true);
          } catch {
            /* ignore */
          }
          settle(() =>
            reject(
              new Error("Video upload timed out after 15 minutes — check signal and tap Retry"),
            ),
          );
        }, TUS_UPLOAD_TIMEOUT_MS);

        if (cancelledUploads.has(input.clientMediaId)) {
          activeAbortByClientId.get(input.clientMediaId)?.();
          return;
        }

        const previous = await upload.findPreviousUploads();
        if (previous.length) {
          upload.resumeFromPreviousUpload(previous[0]!);
        }
        upload.start();
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        settle(() => reject(error instanceof Error ? error : new Error(formatUploadError(error))));
      }
    })();
  });
}

async function processOne(clientMediaId: string): Promise<SiteInspectionDetail | null> {
  if (cancelledUploads.has(clientMediaId)) {
    await deleteItem(clientMediaId).catch(() => undefined);
    return null;
  }
  const item = await getItem(clientMediaId);
  if (!item) return null;
  if (item.status === "uploaded") {
    await deleteItem(clientMediaId);
    return null;
  }
  if (item.nextAttemptAt > Date.now() && item.status === "failed") return null;

  const next: MediaQueueItem = {
    ...item,
    status: "uploading",
    progress: item.progress || 0,
    lastError: null,
  };
  await putItem(next);
  await emit();

  try {
    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }
    const prepareRes = await fetch(`/api/inspections/${item.inspectionId}/media/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshotItemId: item.snapshotItemId,
        clientMediaId: item.clientMediaId,
        mediaType: item.mediaType,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
      }),
    });
    const prepareJson = (await prepareRes.json()) as PrepareResponse & {
      error?: { message?: string };
    };
    if (!prepareRes.ok || !prepareJson.upload) {
      const message = prepareJson.error?.message ?? "Could not prepare upload";
      if (isInspectionGoneStatus(prepareRes.status) || isInspectionGoneMessage(message)) {
        await cancelAndDiscardMediaUpload(clientMediaId);
        return null;
      }
      throw new Error(message);
    }

    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }

    await patchServerStatus(item.inspectionId, item.clientMediaId, "uploading", next.progress);

    const { upload } = prepareJson;
    if (upload.mode === "signed") {
      await uploadSigned(upload.path, upload.token, item.blob, item.mimeType);
    } else if (upload.mode === "tus") {
      await uploadTus({
        clientMediaId,
        blob: item.blob,
        path: upload.path,
        bucket: upload.bucket,
        tusEndpoint: upload.tusEndpoint,
        mimeType: item.mimeType,
        onProgress: (ratio) => {
          void (async () => {
            if (cancelledUploads.has(clientMediaId)) return;
            const current = await getItem(clientMediaId);
            if (!current || current.status !== "uploading") return;
            await putItem({ ...current, progress: ratio });
            await emit();
            if (Math.floor(ratio * 20) !== Math.floor((current.progress || 0) * 20)) {
              await patchServerStatus(item.inspectionId, item.clientMediaId, "uploading", ratio);
            }
          })();
        },
      });
    } else {
      await uploadMemory(item.inspectionId, upload.path, item.blob, item.mimeType);
    }

    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }

    const completeRes = await fetch(`/api/inspections/${item.inspectionId}/media/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMediaId: item.clientMediaId,
        storagePath: upload.path,
        byteSize: item.byteSize,
      }),
    });
    const completeJson = (await completeRes.json()) as {
      inspection?: SiteInspectionDetail;
      error?: { message?: string };
    };
    if (!completeRes.ok || !completeJson.inspection) {
      const message = completeJson.error?.message ?? "Could not finalize upload";
      if (isInspectionGoneStatus(completeRes.status) || isInspectionGoneMessage(message)) {
        await cancelAndDiscardMediaUpload(clientMediaId);
        return null;
      }
      throw new Error(message);
    }

    await deleteItem(clientMediaId);
    await emit();
    return completeJson.inspection;
  } catch (error) {
    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      await emit();
      return null;
    }
    const baseMessage = formatUploadError(error);
    if (isInspectionGoneMessage(baseMessage)) {
      await cancelAndDiscardMediaUpload(clientMediaId);
      return null;
    }
    const attempts = item.attempts + 1;
    const exhausted = attempts >= MAX_UPLOAD_ATTEMPTS;
    const message = exhausted
      ? `${baseMessage} (gave up after ${attempts} attempts — tap Retry or Discard)`
      : baseMessage;
    console.error("[site-inspection-media] upload attempt failed", {
      clientMediaId,
      inspectionId: item.inspectionId,
      mediaType: item.mediaType,
      attempts,
      exhausted,
      message,
    });
    // Update the same row — never enqueue a duplicate clientMediaId.
    await putItem({
      ...item,
      status: "failed",
      attempts,
      nextAttemptAt: exhausted ? Number.MAX_SAFE_INTEGER : Date.now() + backoffMs(attempts),
      lastError: message,
      progress: item.progress,
    });
    await emit();
    await patchServerStatus(item.inspectionId, item.clientMediaId, "failed", null);
    return null;
  }
}

export async function drainMediaQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const items = await listAllItems();
      const now = Date.now();
      const ready = items.filter(
        (entry) =>
          !inFlight.has(entry.clientMediaId) &&
          (entry.status === "queued" ||
            (entry.status === "failed" &&
              entry.nextAttemptAt <= now &&
              entry.nextAttemptAt !== Number.MAX_SAFE_INTEGER) ||
            // Orphaned uploading rows after a crashed drain / reload
            (entry.status === "uploading" && !inFlight.has(entry.clientMediaId))),
      );
      if (!ready.length && activeUploads === 0) break;

      while (activeUploads < MEDIA_UPLOAD_CONCURRENCY && ready.length) {
        const next = ready.shift()!;
        if (inFlight.has(next.clientMediaId)) continue;
        inFlight.add(next.clientMediaId);
        activeUploads += 1;
        void processOne(next.clientMediaId)
          .then((inspection) => {
            if (inspection && inspectionUpdateHandler) {
              inspectionUpdateHandler(inspection);
            }
          })
          .finally(() => {
            inFlight.delete(next.clientMediaId);
            activeUploads -= 1;
            void drainMediaQueue();
          });
      }

      if (activeUploads >= MEDIA_UPLOAD_CONCURRENCY || !ready.length) {
        break;
      }
    }
  } finally {
    draining = false;
  }
}

export function startMediaQueueDrain(options?: {
  onInspectionUpdate?: (inspection: SiteInspectionDetail) => void;
}): () => void {
  if (options?.onInspectionUpdate) {
    inspectionUpdateHandler = options.onInspectionUpdate;
  }
  void drainMediaQueue();
  if (!onlineBound && typeof window !== "undefined") {
    onlineBound = true;
    const onOnline = () => void drainMediaQueue();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      onlineBound = false;
      if (inspectionUpdateHandler === options?.onInspectionUpdate) {
        inspectionUpdateHandler = undefined;
      }
    };
  }
  return () => {
    if (inspectionUpdateHandler === options?.onInspectionUpdate) {
      inspectionUpdateHandler = undefined;
    }
  };
}

export async function retryMediaUpload(clientMediaId: string): Promise<void> {
  const item = await getItem(clientMediaId);
  if (!item) return;
  await putItem({
    ...item,
    status: "queued",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
  await emit();
  void drainMediaQueue();
}

/** Remove a permanently stuck / failed queue item so the inspector is not blocked. */
export async function discardMediaUpload(clientMediaId: string): Promise<void> {
  const item = await getItem(clientMediaId);
  if (item) {
    await deleteItem(clientMediaId);
    await emit();
    await patchServerStatus(item.inspectionId, clientMediaId, "failed", null);
  }
}

/**
 * Cancel an in-flight or queued upload: abort TUS, drop the IndexedDB blob entry,
 * and mark the id cancelled so drain cannot resurrect it.
 */
export async function cancelAndDiscardMediaUpload(clientMediaId: string): Promise<void> {
  cancelledUploads.add(clientMediaId);
  const abort = activeAbortByClientId.get(clientMediaId);
  if (abort) {
    try {
      abort();
    } catch {
      /* ignore */
    }
  }
  activeAbortByClientId.delete(clientMediaId);
  inFlight.delete(clientMediaId);
  await deleteItem(clientMediaId).catch(() => undefined);
  await emit();
}

/** Test-only: insert a queue row (with blob) without going through enqueue/process. */
export async function seedMediaQueueItemForTests(
  input: Omit<MediaQueueItem, "blob"> & { blob?: Blob },
): Promise<void> {
  enableMemoryMediaQueueForTests();
  await putItem({
    ...input,
    blob: input.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: input.mimeType }),
  });
  await emit();
}

export async function enqueueInspectionMedia(input: {
  inspectionId: string;
  snapshotItemId: string;
  file: File;
  mediaType: "photo" | "video";
}): Promise<{
  clientMediaId: string;
  localPreviewUrl: string;
  optimisticMedia: SiteInspectionMedia;
}> {
  const clientMediaId = crypto.randomUUID();
  let blob: Blob = input.file;
  let mimeType = input.file.type || (input.mediaType === "video" ? "video/mp4" : "image/jpeg");
  let byteSize = input.file.size;

  if (input.mediaType === "photo") {
    try {
      const processed = await processReceiptImage(input.file);
      blob = processed.blob;
      mimeType = processed.mimeType || "image/jpeg";
      byteSize = processed.blob.size;
    } catch (error) {
      if (error instanceof ReceiptImageProcessError) throw error;
      throw error;
    }
  } else if (byteSize > VIDEO_MAX_BYTES) {
    throw new Error(VIDEO_WARN_MESSAGE);
  }

  const localPreviewUrl = URL.createObjectURL(blob);
  const now = Date.now();
  const queueItem: MediaQueueItem = {
    clientMediaId,
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    mediaType: input.mediaType,
    mimeType,
    byteSize,
    blob,
    status: "queued",
    attempts: 0,
    nextAttemptAt: 0,
    progress: 0,
    lastError: null,
    storagePath: null,
    createdAt: now,
  };
  await putItem(queueItem);
  await emit();
  void drainMediaQueue();

  const optimisticMedia: SiteInspectionMedia = {
    id: clientMediaId,
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    clientMediaId,
    storagePath: null,
    mediaType: input.mediaType,
    sortOrder: 999,
    uploadStatus: "pending",
    uploadProgress: 0,
    mimeType,
    byteSize,
    createdBy: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    signedUrl: null,
    localPreviewUrl,
  };

  return { clientMediaId, localPreviewUrl, optimisticMedia };
}

export { VIDEO_MAX_BYTES, VIDEO_WARN_MESSAGE, MEDIA_UPLOAD_CONCURRENCY };
