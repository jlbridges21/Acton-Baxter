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

let dbPromise: Promise<IDBDatabase> | null = null;
let draining = false;
let activeUploads = 0;
const listeners = new Set<Listener>();
const inFlight = new Set<string>();

function openDb(): Promise<IDBDatabase> {
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
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE).put(item));
}

async function getItem(clientMediaId: string): Promise<MediaQueueItem | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return idbReq(tx.objectStore(STORE).get(clientMediaId));
}

async function deleteItem(clientMediaId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE).delete(clientMediaId));
}

async function listAllItems(): Promise<MediaQueueItem[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return idbReq(tx.objectStore(STORE).getAll());
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

async function emit(): Promise<MediaQueueSnapshot> {
  const items = await listAllItems();
  const snapshot = toSnapshot(items);
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

export function subscribeMediaQueue(listener: Listener): () => void {
  listeners.add(listener);
  void listAllItems().then((items) => listener(toSnapshot(items)));
  return () => listeners.delete(listener);
}

export async function getMediaQueueSnapshot(): Promise<MediaQueueSnapshot> {
  return toSnapshot(await listAllItems());
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

function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempts, 8));
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
  } catch {
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

function uploadTus(input: {
  blob: Blob;
  path: string;
  bucket: string;
  tusEndpoint: string;
  mimeType: string;
  onProgress: (ratio: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          reject(new Error("Sign in again to upload video"));
          return;
        }
        const env = getPublicEnv();
        const upload = new TusUpload(input.blob, {
          endpoint: input.tusEndpoint,
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
          headers: {
            authorization: `Bearer ${session.access_token}`,
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            "x-upsert": "true",
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024,
          metadata: {
            bucketName: input.bucket,
            objectName: input.path,
            contentType: input.mimeType,
            cacheControl: "3600",
          },
          onError: (error) => reject(error),
          onProgress: (bytesUploaded, bytesTotal) => {
            if (bytesTotal > 0) input.onProgress(bytesUploaded / bytesTotal);
          },
          onSuccess: () => resolve(),
        });
        const previous = await upload.findPreviousUploads();
        if (previous.length) {
          upload.resumeFromPreviousUpload(previous[0]!);
        }
        upload.start();
      } catch (error) {
        reject(error);
      }
    })();
  });
}

async function processOne(clientMediaId: string): Promise<SiteInspectionDetail | null> {
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
      throw new Error(prepareJson.error?.message ?? "Could not prepare upload");
    }

    await patchServerStatus(item.inspectionId, item.clientMediaId, "uploading", next.progress);

    const { upload } = prepareJson;
    if (upload.mode === "signed") {
      await uploadSigned(upload.path, upload.token, item.blob, item.mimeType);
    } else if (upload.mode === "tus") {
      await uploadTus({
        blob: item.blob,
        path: upload.path,
        bucket: upload.bucket,
        tusEndpoint: upload.tusEndpoint,
        mimeType: item.mimeType,
        onProgress: (ratio) => {
          void (async () => {
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
      throw new Error(completeJson.error?.message ?? "Could not finalize upload");
    }

    await deleteItem(clientMediaId);
    await emit();
    return completeJson.inspection;
  } catch (error) {
    const attempts = item.attempts + 1;
    const message = error instanceof Error ? error.message : "Upload failed";
    await putItem({
      ...item,
      status: "failed",
      attempts,
      nextAttemptAt: Date.now() + backoffMs(attempts),
      lastError: message,
      progress: item.progress,
    });
    await emit();
    await patchServerStatus(item.inspectionId, item.clientMediaId, "failed", null);
    return null;
  }
}

export async function drainMediaQueue(options?: {
  onInspectionUpdate?: (inspection: SiteInspectionDetail) => void;
}): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const items = await listAllItems();
      const now = Date.now();
      const ready = items.filter(
        (item) =>
          !inFlight.has(item.clientMediaId) &&
          (item.status === "queued" ||
            (item.status === "failed" && item.nextAttemptAt <= now) ||
            item.status === "uploading"),
      );
      if (!ready.length && activeUploads === 0) break;

      while (activeUploads < MEDIA_UPLOAD_CONCURRENCY && ready.length) {
        const next = ready.shift()!;
        if (inFlight.has(next.clientMediaId)) continue;
        inFlight.add(next.clientMediaId);
        activeUploads += 1;
        void processOne(next.clientMediaId)
          .then((inspection) => {
            if (inspection && options?.onInspectionUpdate) {
              options.onInspectionUpdate(inspection);
            }
          })
          .finally(() => {
            inFlight.delete(next.clientMediaId);
            activeUploads -= 1;
            void drainMediaQueue(options);
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

let onlineBound = false;

export function startMediaQueueDrain(options?: {
  onInspectionUpdate?: (inspection: SiteInspectionDetail) => void;
}): () => void {
  void drainMediaQueue(options);
  if (!onlineBound && typeof window !== "undefined") {
    onlineBound = true;
    const onOnline = () => void drainMediaQueue(options);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      onlineBound = false;
    };
  }
  return () => undefined;
}

export async function retryMediaUpload(clientMediaId: string): Promise<void> {
  const item = await getItem(clientMediaId);
  if (!item) return;
  await putItem({
    ...item,
    status: "queued",
    nextAttemptAt: 0,
    lastError: null,
  });
  await emit();
  void drainMediaQueue();
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
    // Soft path: still queue but surface warning to caller beforehand; hard cap as safety net.
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
