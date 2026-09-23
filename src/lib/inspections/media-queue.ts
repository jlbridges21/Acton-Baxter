/**
 * Persistent background upload queue for site inspection media.
 * Blobs + metadata live in IndexedDB so uploads survive reload / backgrounding.
 */

import { createClient } from "@/lib/supabase/client";
import { getPublicEnv } from "@/lib/env.public";
import { processReceiptImage, ReceiptImageProcessError } from "@/lib/receipts/client-image";
import { MEDIA_UPLOAD_CONCURRENCY, redactApiKeyForLog } from "./media-limits";
import type { SiteInspectionDetail, SiteInspectionMedia } from "./record-types";

const DB_NAME = "baxter-site-inspection-uploads";
const DB_VERSION = 1;
const STORE = "queue";
const MAX_UPLOAD_ATTEMPTS = 8;

export type QueueItemStatus = "queued" | "uploading" | "finalizing" | "uploaded" | "failed";

export type MediaQueueItem = {
  clientMediaId: string;
  inspectionId: string;
  snapshotItemId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  byteSize: number;
  /** Durable copy — IndexedDB Blob handles can go stale on iOS (“Load failed”). */
  bytes: ArrayBuffer;
  blob: Blob;
  /** Optional on-device first-frame JPEG for videos. */
  posterBytes?: ArrayBuffer | null;
  posterMimeType?: string | null;
  status: QueueItemStatus;
  attempts: number;
  nextAttemptAt: number;
  progress: number;
  lastError: string | null;
  storagePath: string | null;
  posterStoragePath?: string | null;
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
  upload:
    | {
        mode: "signed";
        path: string;
        token: string;
        signedUrl: string;
        poster?: { path: string; token: string; signedUrl: string };
      }
    | { mode: "memory"; path: string; poster?: { path: string } };
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
/** Abort hooks for in-flight uploads. */
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

async function materializeDurableBytes(
  blob: Blob,
  mimeType: string,
): Promise<{
  bytes: ArrayBuffer;
  blob: Blob;
  byteSize: number;
}> {
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Media data was empty — try attaching again");
  }
  // Fresh Blob from ArrayBuffer so we are not holding a live File/input reference.
  const durable = new Blob([bytes], { type: mimeType || blob.type || "application/octet-stream" });
  return { bytes, blob: durable, byteSize: bytes.byteLength };
}

function blobForUpload(item: MediaQueueItem): Blob {
  if (item.bytes && item.bytes.byteLength > 0) {
    return new Blob([item.bytes], { type: item.mimeType });
  }
  if (item.blob && item.blob.size > 0) return item.blob;
  throw new Error("Stored media bytes are missing — try attaching again");
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
    if (item.status === "uploading" || item.status === "finalizing") {
      pendingCount += 1;
      if (item.status === "uploading") uploadingCount += 1;
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
    if (item.status === "queued" || item.status === "uploading" || item.status === "finalizing")
      pending += 1;
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
  // Status patches are best-effort and only matter for rows that already exist.
  // We no longer create rows at prepare time, so uploading/pending patches are no-ops.
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

async function uploadSigned(
  path: string,
  token: string,
  signedUrl: string | undefined,
  blob: Blob,
  mimeType: string,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const env = getPublicEnv();
  console.info("[site-inspection-media] signed upload auth (apikey only; JWT in URL token)", {
    apikey: redactApiKeyForLog(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    path,
    hasSignedUrl: Boolean(signedUrl),
  });

  // Prefer XHR against the signed URL so large videos can report progress.
  if (signedUrl && typeof XMLHttpRequest !== "undefined") {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", mimeType);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(event.loaded / event.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve();
          return;
        }
        reject(new Error(`Signed upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Signed upload failed — network error"));
      xhr.send(blob);
    });
    return;
  }

  const supabase = createClient();
  const { error } = await supabase.storage
    .from("site-inspection-media")
    .uploadToSignedUrl(path, token, blob, { contentType: mimeType, upsert: true });
  if (error) {
    const message = error.message || "Signed upload failed";
    // Safari often surfaces revoked/stale blob reads as a bare "Load failed".
    if (/load failed/i.test(message)) {
      throw new Error(
        "Photo upload failed — the file data went stale. Remove and re-attach the photo, then retry.",
      );
    }
    throw new Error(message);
  }
  onProgress?.(1);
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
    status: item.status === "finalizing" ? "finalizing" : "uploading",
    progress: item.status === "finalizing" ? 1 : item.progress || 0,
    lastError: null,
  };
  await putItem(next);
  await emit();

  let bytesLandedPath: string | null =
    item.status === "finalizing" && item.storagePath ? item.storagePath : null;

  try {
    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }

    // Bytes already in storage — only finalize. Avoids the 0→100→0 restart loop.
    if (bytesLandedPath) {
      return await finalizeMediaUpload({
        ...item,
        status: "finalizing",
        storagePath: bytesLandedPath,
        progress: 1,
      });
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

    const uploadBlob = blobForUpload(item);
    const { upload } = prepareJson;
    const abortController = { aborted: false };
    activeAbortByClientId.set(clientMediaId, () => {
      abortController.aborted = true;
    });

    if (upload.mode === "signed") {
      await uploadSigned(
        upload.path,
        upload.token,
        upload.signedUrl,
        uploadBlob,
        item.mimeType,
        (ratio) => {
          if (abortController.aborted || cancelledUploads.has(clientMediaId)) return;
          void (async () => {
            const current = await getItem(clientMediaId);
            if (!current || current.status !== "uploading") return;
            await putItem({ ...current, progress: ratio });
            await emit();
          })();
        },
      );
      // Posters are generated server-side after complete — do not upload client frames.
    } else {
      await uploadMemory(item.inspectionId, upload.path, uploadBlob, item.mimeType);
    }

    activeAbortByClientId.delete(clientMediaId);

    if (cancelledUploads.has(clientMediaId) || abortController.aborted) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }

    // Persist "bytes landed" before complete so a failed attach retries complete only.
    bytesLandedPath = upload.path;
    const latest = (await getItem(clientMediaId)) ?? item;
    await putItem({
      ...latest,
      status: "finalizing",
      storagePath: upload.path,
      posterStoragePath: null,
      progress: 1,
      lastError: null,
    });
    await emit();

    return await finalizeMediaUpload({
      ...latest,
      status: "finalizing",
      storagePath: upload.path,
      posterStoragePath: null,
      progress: 1,
    });
  } catch (error) {
    activeAbortByClientId.delete(clientMediaId);
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
    // Keep finalizing if bytes already landed — retry should not re-upload.
    const keepFinalizing = Boolean(bytesLandedPath);
    await putItem({
      ...item,
      status: keepFinalizing ? "finalizing" : "failed",
      storagePath: bytesLandedPath ?? item.storagePath,
      attempts,
      nextAttemptAt: exhausted ? Number.MAX_SAFE_INTEGER : Date.now() + backoffMs(attempts),
      lastError: message,
      progress: keepFinalizing ? 1 : item.progress,
    });
    await emit();
    return null;
  }
}

async function finalizeMediaUpload(item: MediaQueueItem): Promise<SiteInspectionDetail | null> {
  if (!item.storagePath) throw new Error("Missing storage path for finalize");
  const completeRes = await fetch(`/api/inspections/${item.inspectionId}/media/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientMediaId: item.clientMediaId,
      snapshotItemId: item.snapshotItemId,
      mediaType: item.mediaType,
      mimeType: item.mimeType,
      storagePath: item.storagePath,
      byteSize: item.byteSize,
      ...(item.posterStoragePath ? { posterStoragePath: item.posterStoragePath } : {}),
    }),
  });
  const completeJson = (await completeRes.json()) as {
    inspection?: SiteInspectionDetail;
    error?: { message?: string };
  };
  if (!completeRes.ok || !completeJson.inspection) {
    const message = completeJson.error?.message ?? "Could not finalize upload";
    if (isInspectionGoneStatus(completeRes.status) || isInspectionGoneMessage(message)) {
      await cancelAndDiscardMediaUpload(item.clientMediaId);
      return null;
    }
    throw new Error(message);
  }

  await deleteItem(item.clientMediaId);
  await emit();
  return completeJson.inspection;
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
            entry.status === "finalizing" ||
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
  // Finalizing rows already have bytes in storage — just clear backoff and drain.
  if (item.status === "finalizing" && item.storagePath) {
    await putItem({
      ...item,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  } else {
    await putItem({
      ...item,
      status: "queued",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  }
  await emit();
  void drainMediaQueue();
}

/** Remove a permanently stuck / failed queue item so the inspector is not blocked. */
export async function discardMediaUpload(clientMediaId: string): Promise<void> {
  const item = await getItem(clientMediaId);
  if (item) {
    await deleteItem(clientMediaId);
    await emit();
    // Best-effort: only affects rows that somehow exist (legacy orphans).
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
  input: Omit<MediaQueueItem, "blob" | "bytes"> & { blob?: Blob; bytes?: ArrayBuffer },
): Promise<void> {
  enableMemoryMediaQueueForTests();
  const blob = input.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: input.mimeType });
  const bytes = input.bytes ?? (await blob.arrayBuffer());
  await putItem({
    ...input,
    bytes,
    blob: new Blob([bytes], { type: input.mimeType }),
    byteSize: input.byteSize || bytes.byteLength,
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
  let sourceBlob: Blob = input.file;
  let mimeType = input.file.type || (input.mediaType === "video" ? "video/mp4" : "image/jpeg");

  if (input.mediaType === "photo") {
    try {
      const processed = await processReceiptImage(input.file);
      sourceBlob = processed.blob;
      mimeType = processed.mimeType || "image/jpeg";
    } catch (error) {
      if (error instanceof ReceiptImageProcessError) throw error;
      throw error;
    }
  }

  // Copy into ArrayBuffer immediately so queued items don't depend on a live File
  // (iOS can invalidate input Files; Safari IDB Blob handles can throw "Load failed").
  // Posters are generated server-side after upload complete — not on-device.
  const durable = await materializeDurableBytes(sourceBlob, mimeType);
  const localPreviewUrl = URL.createObjectURL(durable.blob);
  const now = Date.now();
  const queueItem: MediaQueueItem = {
    clientMediaId,
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    mediaType: input.mediaType,
    mimeType,
    byteSize: durable.byteSize,
    bytes: durable.bytes,
    blob: durable.blob,
    posterBytes: null,
    posterMimeType: null,
    status: "queued",
    attempts: 0,
    nextAttemptAt: 0,
    progress: 0,
    lastError: null,
    storagePath: null,
    posterStoragePath: null,
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
    byteSize: durable.byteSize,
    createdBy: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    signedUrl: null,
    posterSignedUrl: null,
    localPreviewUrl,
    localPosterUrl: null,
  };

  return { clientMediaId, localPreviewUrl, optimisticMedia };
}

export { VIDEO_WARN_MESSAGE, MEDIA_UPLOAD_CONCURRENCY, VIDEO_MAX_BYTES } from "./media-limits";
export {
  normalizeAccessToken,
  redactAuthorizationForLog,
  redactApiKeyForLog,
  supabaseResumableUploadEndpoint,
} from "./media-limits";
