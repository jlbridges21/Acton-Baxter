/**
 * Persistent background upload queue for site inspection media.
 * Blobs + metadata live in IndexedDB so uploads survive reload / backgrounding.
 *
 * Storage strategy: copy the selected File once into a fresh Blob (detaching from
 * the input element — that was the iOS stale-handle bug), then persist that Blob
 * in IndexedDB. Safari keeps IDB Blobs disk-backed, so we do NOT keep ArrayBuffers
 * resident in memory (that caused connection reclaim under many large videos).
 */

import { Upload as TusUpload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { getPublicEnv } from "@/lib/env.public";
import { processReceiptImage, ReceiptImageProcessError } from "@/lib/receipts/client-image";
import {
  LARGE_VIDEO_SERIAL_BYTES,
  MEDIA_UPLOAD_CONCURRENCY,
  TUS_CHUNK_SIZE_BYTES,
  normalizeAccessToken,
  redactApiKeyForLog,
  redactAuthorizationForLog,
} from "./media-limits";
import type { SiteInspectionDetail, SiteInspectionMedia } from "./record-types";
import { SITE_INSPECTION_MEDIA_BUCKET } from "./record-types";

const DB_NAME = "baxter-site-inspection-uploads";
const DB_VERSION = 1;
const STORE = "queue";
const MAX_UPLOAD_ATTEMPTS = 8;
/** Fail an upload that sits at 0% (or any stalled progress) this long with no activity. */
export const UPLOAD_STALL_TIMEOUT_MS = 120_000;
/** Hard ceiling for prepare / complete / memory-upload fetches (no progress events). */
export const UPLOAD_REQUEST_TIMEOUT_MS = 90_000;
/**
 * UI + drain watchdog: if pending items show no progress this long while the
 * page is open, surface a stall and offer Retry all.
 */
export const QUEUE_STALL_WATCHDOG_MS = 3 * 60_000;
/** Periodic drain tick — recovers when backoff expires or a drain loop exited early. */
export const DRAIN_POLL_INTERVAL_MS = 15_000;
/** Large videos on cell need a long window; TUS resume handles shorter outages. */
const TUS_UPLOAD_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export type QueueItemStatus = "queued" | "uploading" | "finalizing" | "uploaded" | "failed";

export type MediaQueueItem = {
  clientMediaId: string;
  inspectionId: string;
  snapshotItemId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  byteSize: number;
  /**
   * Durable Blob copy (not a live File). IndexedDB-backed on Safari — disk, not RAM.
   * Legacy rows may still carry `bytes?: ArrayBuffer`; those are migrated on read.
   */
  blob: Blob;
  /** @deprecated Prefer `blob`. Kept optional for migrating older queue rows. */
  bytes?: ArrayBuffer;
  /** Optional on-device first-frame JPEG for videos (legacy; posters are server-side now). */
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
  /** Wall-clock of last progress/status activity — used for stall detection. */
  lastProgressAt?: number;
};

export type MediaQueueItemSnapshot = {
  clientMediaId: string;
  inspectionId: string;
  snapshotItemId: string;
  mediaType: "photo" | "video";
  status: QueueItemStatus;
  progress: number;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: number;
  lastProgressAt: number | null;
  createdAt: number;
  byteSize: number;
  /** Human-readable reason for the sticky status strip. */
  statusReason: string;
  /** True when no progress for QUEUE_STALL_WATCHDOG_MS while still pending. */
  isStalled: boolean;
};

export type MediaQueueSnapshot = {
  pendingCount: number;
  failedCount: number;
  uploadingCount: number;
  stalledCount: number;
  items: MediaQueueItemSnapshot[];
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
    | { mode: "tus"; path: string; bucket: string; tusEndpoint: string }
    | { mode: "memory"; path: string; poster?: { path: string } };
};

type Listener = (snapshot: MediaQueueSnapshot) => void;
type InspectionUpdateHandler = (inspection: SiteInspectionDetail) => void;
type QueueListener = { fn: Listener; inspectionId: string | null };

let dbPromise: Promise<IDBDatabase> | null = null;
let draining = false;
let drainingStartedAt = 0;
let activeUploads = 0;
/** Bumped by retryAll so superseded processOne handlers do not corrupt state. */
let drainGeneration = 0;
const listeners = new Set<QueueListener>();
const inFlight = new Set<string>();
/** clientMediaIds the user cancelled — processOne must not re-queue or patch failed. */
const cancelledUploads = new Set<string>();
/** Abort hooks for in-flight uploads. */
const activeAbortByClientId = new Map<string, () => void>();
let inspectionUpdateHandler: InspectionUpdateHandler | undefined;
let onlineBound = false;
let drainPollTimer: ReturnType<typeof setInterval> | null = null;
let backoffWakeTimer: ReturnType<typeof setTimeout> | null = null;

/** In-memory queue for unit tests (IndexedDB unavailable / deterministic). */
let memoryQueue: Map<string, MediaQueueItem> | null = null;

export function resetMediaQueueMemoryForTests(): void {
  memoryQueue = new Map();
  dbPromise = null;
  draining = false;
  drainingStartedAt = 0;
  activeUploads = 0;
  drainGeneration = 0;
  listeners.clear();
  inFlight.clear();
  cancelledUploads.clear();
  activeAbortByClientId.clear();
  inspectionUpdateHandler = undefined;
  onlineBound = false;
  if (drainPollTimer) {
    clearInterval(drainPollTimer);
    drainPollTimer = null;
  }
  if (backoffWakeTimer) {
    clearTimeout(backoffWakeTimer);
    backoffWakeTimer = null;
  }
}

export function enableMemoryMediaQueueForTests(): void {
  if (!memoryQueue) memoryQueue = new Map();
}

function isIdbClosingError(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    name === "InvalidStateError" ||
    /connection is closing/i.test(message) ||
    /database connection is closing/i.test(message) ||
    /InvalidStateError/i.test(message)
  );
}

function attachDbLifecycle(db: IDBDatabase): void {
  db.onclose = () => {
    console.warn("[site-inspection-media] IndexedDB connection closed — will reopen");
    if (dbPromise) dbPromise = null;
  };
  db.onversionchange = () => {
    console.warn("[site-inspection-media] IndexedDB versionchange — closing for reopen");
    try {
      db.close();
    } catch {
      /* ignore */
    }
    dbPromise = null;
  };
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
      req.onsuccess = () => {
        const db = req.result;
        attachDbLifecycle(db);
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
      req.onblocked = () => {
        console.warn("[site-inspection-media] IndexedDB open blocked");
      };
    });
  }
  return dbPromise;
}

/** Invalidate cached connection so the next call reopens. */
export function resetIdbConnectionForTests(): void {
  dbPromise = null;
}

async function withIdbRetry<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (attempts > 1 && isIdbClosingError(error)) {
      console.warn("[site-inspection-media] IndexedDB closing mid-op — reopening and retrying", {
        message: error instanceof Error ? error.message : String(error),
        attemptsLeft: attempts - 1,
      });
      dbPromise = null;
      return withIdbRetry(operation, attempts - 1);
    }
    throw error;
  }
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Normalize a row loaded from IDB: prefer Blob, drop resident ArrayBuffers so
 * subsequent puts don't re-pin hundreds of MB in JS heap.
 */
function normalizeQueueItem(raw: MediaQueueItem): MediaQueueItem {
  let blob = raw.blob;
  if ((!blob || blob.size === 0) && raw.bytes && raw.bytes.byteLength > 0) {
    blob = new Blob([raw.bytes], { type: raw.mimeType || "application/octet-stream" });
  }
  const { bytes: _drop, ...rest } = raw;
  return {
    ...rest,
    blob,
    byteSize: raw.byteSize || blob.size,
  };
}

/** Persist without ArrayBuffer payload — Blob only. */
function toPersistable(item: MediaQueueItem): MediaQueueItem {
  const normalized = normalizeQueueItem(item);
  const { bytes: _omit, ...rest } = normalized;
  return rest;
}

async function putItem(item: MediaQueueItem): Promise<void> {
  const persistable = toPersistable(item);
  if (memoryQueue) {
    memoryQueue.set(persistable.clientMediaId, persistable);
    return;
  }
  await withIdbRetry(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(persistable);
    await idbTxDone(tx);
  });
}

/**
 * Copy once off the live File/input Blob into a fresh Blob.
 * We intentionally do NOT keep the intermediate ArrayBuffer on the queue item —
 * that was pinning video bytes in RAM and triggering Safari IDB reclaim.
 */
async function materializeDurableBytes(
  blob: Blob,
  mimeType: string,
): Promise<{
  blob: Blob;
  byteSize: number;
}> {
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Media data was empty — try attaching again");
  }
  const durable = new Blob([bytes], { type: mimeType || blob.type || "application/octet-stream" });
  return { blob: durable, byteSize: bytes.byteLength };
}

function blobForUpload(item: MediaQueueItem): Blob {
  const normalized = normalizeQueueItem(item);
  if (normalized.blob && normalized.blob.size > 0) return normalized.blob;
  throw new Error("Stored media bytes are missing — try attaching again");
}

async function getItem(clientMediaId: string): Promise<MediaQueueItem | undefined> {
  if (memoryQueue) {
    const row = memoryQueue.get(clientMediaId);
    return row ? normalizeQueueItem(row) : undefined;
  }
  return withIdbRetry(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const raw = await idbReq(tx.objectStore(STORE).get(clientMediaId));
    await idbTxDone(tx);
    if (!raw) return undefined;
    const normalized = normalizeQueueItem(raw as MediaQueueItem);
    // Opportunistically rewrite legacy ArrayBuffer rows to Blob-only.
    if ((raw as MediaQueueItem).bytes && (raw as MediaQueueItem).bytes!.byteLength > 0) {
      void putItem(normalized).catch(() => undefined);
    }
    return normalized;
  });
}

async function deleteItem(clientMediaId: string): Promise<void> {
  if (memoryQueue) {
    memoryQueue.delete(clientMediaId);
    return;
  }
  await withIdbRetry(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientMediaId);
    await idbTxDone(tx);
  });
}

async function listAllItems(): Promise<MediaQueueItem[]> {
  if (memoryQueue) {
    return Array.from(memoryQueue.values()).map(normalizeQueueItem);
  }
  return withIdbRetry(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const raw = (await idbReq(tx.objectStore(STORE).getAll())) as MediaQueueItem[];
    await idbTxDone(tx);
    return raw.map(normalizeQueueItem);
  });
}

function filterItemsForInspection(
  items: MediaQueueItem[],
  inspectionId: string | null | undefined,
): MediaQueueItem[] {
  if (!inspectionId) return items;
  return items.filter((item) => item.inspectionId === inspectionId);
}

function describeQueueItemStatus(
  item: MediaQueueItem,
  now: number,
): {
  statusReason: string;
  isStalled: boolean;
} {
  const anchor = item.lastProgressAt ?? item.createdAt;
  const stalled =
    (item.status === "queued" || item.status === "uploading" || item.status === "finalizing") &&
    now - anchor >= QUEUE_STALL_WATCHDOG_MS;

  if (item.status === "failed") {
    if (item.nextAttemptAt === Number.MAX_SAFE_INTEGER) {
      return {
        statusReason: item.lastError ?? "Failed — tap Retry or Discard",
        isStalled: false,
      };
    }
    if (item.nextAttemptAt > now) {
      const secs = Math.max(1, Math.ceil((item.nextAttemptAt - now) / 1000));
      return {
        statusReason: `Waiting to retry in ${secs}s${item.lastError ? ` — ${item.lastError}` : ""}`,
        isStalled: false,
      };
    }
    return {
      statusReason: item.lastError ?? "Failed — retrying",
      isStalled: false,
    };
  }
  if (item.status === "uploading") {
    const pct = Math.round((item.progress || 0) * 100);
    return {
      statusReason: stalled
        ? `Upload stalled at ${pct}% — nothing moved for several minutes`
        : `Uploading ${pct}%`,
      isStalled: stalled,
    };
  }
  if (item.status === "finalizing") {
    return {
      statusReason: stalled
        ? "Finalize stalled — server did not confirm the upload"
        : "Finalizing on server…",
      isStalled: stalled,
    };
  }
  if (item.status === "queued") {
    return {
      statusReason: stalled
        ? "Queued with no progress for several minutes — tap Retry all"
        : "Queued — waiting for an upload slot",
      isStalled: stalled,
    };
  }
  return { statusReason: "Uploaded", isStalled: false };
}

function toSnapshot(items: MediaQueueItem[]): MediaQueueSnapshot {
  const now = Date.now();
  let pendingCount = 0;
  let failedCount = 0;
  let uploadingCount = 0;
  let stalledCount = 0;
  const mapped: MediaQueueItemSnapshot[] = [];
  for (const item of items) {
    if (item.status === "queued") pendingCount += 1;
    if (item.status === "uploading" || item.status === "finalizing") {
      pendingCount += 1;
      if (item.status === "uploading") uploadingCount += 1;
    }
    if (item.status === "failed") failedCount += 1;
    const { statusReason, isStalled } = describeQueueItemStatus(item, now);
    if (isStalled) stalledCount += 1;
    mapped.push({
      clientMediaId: item.clientMediaId,
      inspectionId: item.inspectionId,
      snapshotItemId: item.snapshotItemId,
      mediaType: item.mediaType,
      status: item.status,
      progress: item.progress,
      lastError: item.lastError,
      attempts: item.attempts,
      nextAttemptAt: item.nextAttemptAt,
      lastProgressAt: item.lastProgressAt ?? null,
      createdAt: item.createdAt,
      byteSize: item.byteSize,
      statusReason,
      isStalled,
    });
  }
  return {
    pendingCount,
    failedCount,
    uploadingCount,
    stalledCount,
    items: mapped,
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
 * Remove every queue entry (and blob) for one inspection — used on **delete
 * inspection** only. Do not call on navigate-away; pending uploads must survive.
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

function scheduleBackoffWakeup(): void {
  if (typeof window === "undefined") return;
  void listAllItems()
    .then((items) => {
      const now = Date.now();
      let soonest: number | null = null;
      for (const item of items) {
        if (
          item.status === "failed" &&
          item.nextAttemptAt > now &&
          item.nextAttemptAt !== Number.MAX_SAFE_INTEGER
        ) {
          if (soonest === null || item.nextAttemptAt < soonest) soonest = item.nextAttemptAt;
        }
        // Finalizing rows may also carry a backoff after a failed complete.
        if (
          item.status === "finalizing" &&
          item.nextAttemptAt > now &&
          item.nextAttemptAt !== Number.MAX_SAFE_INTEGER
        ) {
          if (soonest === null || item.nextAttemptAt < soonest) soonest = item.nextAttemptAt;
        }
      }
      if (backoffWakeTimer) {
        clearTimeout(backoffWakeTimer);
        backoffWakeTimer = null;
      }
      if (soonest == null) return;
      const delay = Math.min(Math.max(50, soonest - now + 25), 5 * 60_000);
      backoffWakeTimer = setTimeout(() => {
        backoffWakeTimer = null;
        console.info("[site-inspection-media] backoff wake — restarting drain");
        void drainMediaQueue();
      }, delay);
    })
    .catch(() => undefined);
}

/**
 * fetch() with AbortSignal timeout so prepare / complete / memory upload cannot
 * hold an inFlight slot forever (the field wedge: "N pending, 0 failed").
 */
export async function fetchWithUploadTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number = UPLOAD_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !parentSignal?.aborted) {
      throw new Error(
        `Upload request timed out after ${Math.round(timeoutMs / 1000)}s — tap Retry`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function isLargeVideoItem(item: Pick<MediaQueueItem, "mediaType" | "byteSize">): boolean {
  return item.mediaType === "video" && item.byteSize >= LARGE_VIDEO_SERIAL_BYTES;
}

function isSignedUrlExpiredError(message: string): boolean {
  return (
    /expir/i.test(message) ||
    /jwt/i.test(message) ||
    /token/i.test(message) ||
    /signed upload failed \(40[013]\)/i.test(message) ||
    /403/.test(message) ||
    /401/.test(message)
  );
}

async function resolveAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || "Sign in again to upload video");
  }
  if (!session?.access_token) {
    throw new Error("Sign in again to upload video");
  }

  let token = session.access_token;
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs && expiresAtMs - Date.now() < 60_000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      throw new Error("Session expired — sign in again to finish the video upload");
    }
    token = data.session.access_token;
  }

  return normalizeAccessToken(token);
}

/**
 * Resumable TUS upload for video. Fingerprints are kept until /media/complete so
 * Retry / Retry all / reconnect continue from the last committed chunk rather
 * than restarting at 0%.
 */
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
        const env = getPublicEnv();
        // Authorization is set ONLY in onBeforeRequest. Putting it in `headers` AND
        // calling setHeader again makes XHR concatenate values → "Bearer a, Bearer a"
        // which Supabase rejects as Invalid Compact JWS.
        upload = new TusUpload(input.blob, {
          endpoint: input.tusEndpoint,
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            "x-upsert": "true",
          },
          uploadDataDuringCreation: true,
          // Keep fingerprint until /media/complete succeeds so retries resume, not restart.
          removeFingerprintOnSuccess: false,
          chunkSize: TUS_CHUNK_SIZE_BYTES,
          metadata: {
            bucketName: input.bucket,
            objectName: input.path,
            contentType: input.mimeType,
            cacheControl: "3600",
          },
          onBeforeRequest: async (req) => {
            try {
              const accessToken = await resolveAccessToken();
              const authorization = `Bearer ${accessToken}`;
              console.info(
                "[site-inspection-media] TUS Authorization",
                redactAuthorizationForLog(authorization),
              );
              req.setHeader("Authorization", authorization);
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
                { status, message: err.message },
              );
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
            reject(new Error("Video upload timed out after 3 hours — check signal and tap Retry")),
          );
        }, TUS_UPLOAD_TIMEOUT_MS);

        if (cancelledUploads.has(input.clientMediaId)) {
          activeAbortByClientId.get(input.clientMediaId)?.();
          return;
        }

        const previous = await upload.findPreviousUploads();
        if (previous.length) {
          const prior = previous[0] as { sizeUploaded?: number };
          console.info("[site-inspection-media] TUS resume from previous upload", {
            path: input.path,
            previousCount: previous.length,
            sizeUploaded: prior.sizeUploaded ?? null,
          });
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

async function uploadSigned(
  path: string,
  token: string,
  signedUrl: string | undefined,
  blob: Blob,
  mimeType: string,
  onProgress?: (ratio: number) => void,
  options?: { onAbort?: (abort: () => void) => void; stallTimeoutMs?: number },
): Promise<void> {
  const env = getPublicEnv();
  console.info("[site-inspection-media] signed upload auth (apikey only; JWT in URL token)", {
    apikey: redactApiKeyForLog(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    path,
    hasSignedUrl: Boolean(signedUrl),
  });

  const stallTimeoutMs = options?.stallTimeoutMs ?? UPLOAD_STALL_TIMEOUT_MS;

  // Prefer XHR against the signed URL so large videos can report progress.
  if (signedUrl && typeof XMLHttpRequest !== "undefined") {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let lastActivityAt = Date.now();
      let settled = false;
      const stallTimer = setInterval(() => {
        if (settled) return;
        if (Date.now() - lastActivityAt >= stallTimeoutMs) {
          settled = true;
          clearInterval(stallTimer);
          try {
            xhr.abort();
          } catch {
            /* ignore */
          }
          reject(
            new Error(
              `Upload stalled with no progress for ${Math.round(stallTimeoutMs / 1000)}s — tap Retry`,
            ),
          );
        }
      }, 5_000);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        fn();
      };

      options?.onAbort?.(() => {
        finish(() => {
          try {
            xhr.abort();
          } catch {
            /* ignore */
          }
          reject(new Error("Upload cancelled"));
        });
      });

      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", mimeType);
      xhr.upload.onprogress = (event) => {
        lastActivityAt = Date.now();
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(event.loaded / event.total);
        } else if (event.loaded > 0) {
          // Some Safari builds omit total; any bytes moving still count as activity.
          onProgress?.(Math.min(0.99, event.loaded / Math.max(blob.size, 1)));
        }
      };
      xhr.onload = () => {
        finish(() => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress?.(1);
            resolve();
            return;
          }
          reject(new Error(`Signed upload failed (${xhr.status})`));
        });
      };
      xhr.onerror = () => finish(() => reject(new Error("Signed upload failed — network error")));
      xhr.onabort = () => {
        /* abort handled by stall/cancel finish paths */
      };
      // Mark activity when send starts so a hung socket before first progress still times out
      // from this moment (covers the "uploading 0%" hang).
      lastActivityAt = Date.now();
      xhr.send(blob);
    });
    return;
  }

  const supabase = createClient();
  const startedAt = Date.now();
  let stallReject: ((error: Error) => void) | null = null;
  const stallWatch = new Promise<never>((_, reject) => {
    stallReject = reject;
  });
  const stallInterval = setInterval(() => {
    if (Date.now() - startedAt >= stallTimeoutMs) {
      stallReject?.(
        new Error(
          `Upload stalled with no progress for ${Math.round(stallTimeoutMs / 1000)}s — tap Retry`,
        ),
      );
    }
  }, 5_000);
  try {
    const { error } = await Promise.race([
      supabase.storage
        .from("site-inspection-media")
        .uploadToSignedUrl(path, token, blob, { contentType: mimeType, upsert: true }),
      stallWatch,
    ]);
    if (error) {
      const message = error.message || "Signed upload failed";
      // Safari often surfaces revoked/stale blob reads as a bare "Load failed".
      if (/load failed/i.test(message)) {
        throw new Error(
          "Media upload failed — the file data went stale. Remove and re-attach, then retry.",
        );
      }
      throw new Error(message);
    }
    onProgress?.(1);
  } finally {
    clearInterval(stallInterval);
  }
}

async function uploadMemory(inspectionId: string, path: string, blob: Blob, mimeType: string) {
  const form = new FormData();
  form.set("path", path);
  form.set("file", new File([blob], "upload.bin", { type: mimeType }));
  // Large payloads: allow stall timeout from send start (no upload progress events).
  const timeoutMs = Math.max(UPLOAD_STALL_TIMEOUT_MS, UPLOAD_REQUEST_TIMEOUT_MS);
  const res = await fetchWithUploadTimeout(
    `/api/inspections/${inspectionId}/media/bytes`,
    { method: "POST", body: form },
    timeoutMs,
  );
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? "Memory upload failed");
  }
}

async function processOne(clientMediaId: string): Promise<SiteInspectionDetail | null> {
  const generation = drainGeneration;
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
  // Respect backoff for failed / finalizing-after-error rows.
  if (
    item.nextAttemptAt > Date.now() &&
    (item.status === "failed" || item.status === "finalizing") &&
    item.attempts > 0
  ) {
    return null;
  }

  const next: MediaQueueItem = {
    ...item,
    status: item.status === "finalizing" ? "finalizing" : "uploading",
    progress: item.status === "finalizing" ? 1 : item.progress || 0,
    lastError: null,
    lastProgressAt: Date.now(),
  };
  await putItem(next);
  await emit();

  let bytesLandedPath: string | null =
    item.status === "finalizing" && item.storagePath ? item.storagePath : null;

  try {
    if (generation !== drainGeneration) return null;
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

    const prepareRes = await fetchWithUploadTimeout(
      `/api/inspections/${item.inspectionId}/media/prepare`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotItemId: item.snapshotItemId,
          clientMediaId: item.clientMediaId,
          mediaType: item.mediaType,
          mimeType: item.mimeType,
          byteSize: item.byteSize,
        }),
      },
      UPLOAD_REQUEST_TIMEOUT_MS,
    );
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

    if (generation !== drainGeneration) return null;
    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      return null;
    }

    const uploadBlob = blobForUpload(item);
    let upload = prepareJson.upload;
    const abortController = { aborted: false };
    let xhrAbort: (() => void) | null = null;
    activeAbortByClientId.set(clientMediaId, () => {
      abortController.aborted = true;
      xhrAbort?.();
    });

    const reportProgress = (ratio: number) => {
      if (abortController.aborted || cancelledUploads.has(clientMediaId)) return;
      if (generation !== drainGeneration) return;
      void (async () => {
        const current = await getItem(clientMediaId);
        if (!current || current.status !== "uploading") return;
        await putItem({ ...current, progress: ratio, lastProgressAt: Date.now() });
        await emit();
      })();
    };

    if (upload.mode === "tus") {
      // Posters are generated server-side after complete — do not upload client frames.
      await uploadTus({
        clientMediaId,
        blob: uploadBlob,
        path: upload.path,
        bucket: upload.bucket || SITE_INSPECTION_MEDIA_BUCKET,
        tusEndpoint: upload.tusEndpoint,
        mimeType: item.mimeType,
        onProgress: reportProgress,
      });
    } else if (upload.mode === "signed") {
      // Mint is already at processOne start. If the signed URL expired while this
      // photo waited behind a long video, refresh once and retry the PUT.
      try {
        await uploadSigned(
          upload.path,
          upload.token,
          upload.signedUrl,
          uploadBlob,
          item.mimeType,
          reportProgress,
          {
            onAbort: (abort) => {
              xhrAbort = abort;
            },
          },
        );
      } catch (signedError) {
        const msg = formatUploadError(signedError);
        if (!isSignedUrlExpiredError(msg) || cancelledUploads.has(clientMediaId)) {
          throw signedError;
        }
        console.warn("[site-inspection-media] signed URL expired — re-preparing", {
          clientMediaId,
          message: msg,
        });
        const refreshRes = await fetchWithUploadTimeout(
          `/api/inspections/${item.inspectionId}/media/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              snapshotItemId: item.snapshotItemId,
              clientMediaId: item.clientMediaId,
              mediaType: item.mediaType,
              mimeType: item.mimeType,
              byteSize: item.byteSize,
            }),
          },
          UPLOAD_REQUEST_TIMEOUT_MS,
        );
        const refreshJson = (await refreshRes.json()) as PrepareResponse & {
          error?: { message?: string };
        };
        if (!refreshRes.ok || !refreshJson.upload || refreshJson.upload.mode !== "signed") {
          throw new Error(refreshJson.error?.message ?? "Could not refresh signed upload");
        }
        upload = refreshJson.upload;
        await uploadSigned(
          upload.path,
          upload.token,
          upload.signedUrl,
          uploadBlob,
          item.mimeType,
          reportProgress,
          {
            onAbort: (abort) => {
              xhrAbort = abort;
            },
          },
        );
      }
    } else {
      await uploadMemory(item.inspectionId, upload.path, uploadBlob, item.mimeType);
    }

    activeAbortByClientId.delete(clientMediaId);

    if (generation !== drainGeneration) return null;
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
      lastProgressAt: Date.now(),
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
    if (generation !== drainGeneration) return null;
    if (cancelledUploads.has(clientMediaId)) {
      await deleteItem(clientMediaId).catch(() => undefined);
      await emit();
      return null;
    }
    const baseMessage = formatUploadError(error);
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      /upload cancelled/i.test(baseMessage)
    ) {
      await deleteItem(clientMediaId).catch(() => undefined);
      await emit();
      return null;
    }
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
      inFlightSize: inFlight.size,
      activeUploads,
      drainGeneration: generation,
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
      lastProgressAt: Date.now(),
    });
    await emit();
    scheduleBackoffWakeup();
    return null;
  }
}

async function finalizeMediaUpload(item: MediaQueueItem): Promise<SiteInspectionDetail | null> {
  if (!item.storagePath) throw new Error("Missing storage path for finalize");
  const completeRes = await fetchWithUploadTimeout(
    `/api/inspections/${item.inspectionId}/media/complete`,
    {
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
    },
    UPLOAD_REQUEST_TIMEOUT_MS,
  );
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
  if (draining) {
    // Safety: a hung listAllItems / IDB op must not leave draining=true forever.
    if (drainingStartedAt && Date.now() - drainingStartedAt > UPLOAD_REQUEST_TIMEOUT_MS) {
      console.error(
        "[site-inspection-media] drain flag stuck — forcing clear so uploads can resume",
        {
          drainingForMs: Date.now() - drainingStartedAt,
          activeUploads,
          inFlight: inFlight.size,
        },
      );
      draining = false;
      drainingStartedAt = 0;
      inFlight.clear();
      activeUploads = 0;
      drainGeneration += 1;
    } else {
      return;
    }
  }
  draining = true;
  drainingStartedAt = Date.now();
  const generation = drainGeneration;
  try {
    while (generation === drainGeneration) {
      let items: MediaQueueItem[];
      try {
        items = await listAllItems();
      } catch (error) {
        console.error("[site-inspection-media] drain listAllItems failed — will retry on poll", {
          error: formatUploadError(error),
        });
        break;
      }
      const now = Date.now();
      const ready = items.filter((entry) => {
        if (inFlight.has(entry.clientMediaId)) return false;
        if (entry.status === "queued") return true;
        if (entry.status === "finalizing") {
          // Respect backoff after a failed complete; otherwise always eligible.
          if (entry.attempts > 0 && entry.nextAttemptAt > now) return false;
          return true;
        }
        if (
          entry.status === "failed" &&
          entry.nextAttemptAt <= now &&
          entry.nextAttemptAt !== Number.MAX_SAFE_INTEGER
        ) {
          return true;
        }
        // Orphaned uploading rows after a crashed drain / reload / hung slot clear
        if (entry.status === "uploading") return true;
        return false;
      });
      if (!ready.length && activeUploads === 0) break;

      const inFlightItems = items.filter((entry) => inFlight.has(entry.clientMediaId));
      let largeVideoUploading = inFlightItems.some((entry) => isLargeVideoItem(entry));

      while (
        generation === drainGeneration &&
        activeUploads < MEDIA_UPLOAD_CONCURRENCY &&
        ready.length
      ) {
        // Large videos are serial — skip them while another large video is in flight.
        let pickIndex = 0;
        if (largeVideoUploading) {
          pickIndex = ready.findIndex((entry) => !isLargeVideoItem(entry));
          if (pickIndex < 0) break;
        } else {
          // Prefer starting at most one large video; photos fill remaining slots.
          pickIndex = 0;
        }
        const next = ready.splice(pickIndex, 1)[0]!;
        if (inFlight.has(next.clientMediaId)) continue;
        if (isLargeVideoItem(next) && largeVideoUploading) continue;
        inFlight.add(next.clientMediaId);
        activeUploads += 1;
        if (isLargeVideoItem(next)) largeVideoUploading = true;
        console.info("[site-inspection-media] drain starting upload", {
          clientMediaId: next.clientMediaId,
          status: next.status,
          mediaType: next.mediaType,
          byteSize: next.byteSize,
          largeVideoSerial: isLargeVideoItem(next),
          activeUploads,
          inFlight: inFlight.size,
        });
        void processOne(next.clientMediaId)
          .then((inspection) => {
            if (generation !== drainGeneration) return;
            if (inspection && inspectionUpdateHandler) {
              inspectionUpdateHandler(inspection);
            }
          })
          .catch((error) => {
            console.error("[site-inspection-media] processOne unhandled rejection", {
              clientMediaId: next.clientMediaId,
              error: formatUploadError(error),
            });
          })
          .finally(() => {
            inFlight.delete(next.clientMediaId);
            activeUploads = Math.max(0, activeUploads - 1);
            if (generation === drainGeneration) {
              void drainMediaQueue();
            }
          });
      }

      if (activeUploads >= MEDIA_UPLOAD_CONCURRENCY || !ready.length) {
        break;
      }
    }
  } finally {
    if (generation === drainGeneration) {
      draining = false;
      drainingStartedAt = 0;
    }
  }
}

/**
 * Force-restart the drain from a clean in-memory state and re-queue every
 * non-uploaded item (optionally scoped to one inspection). Escape hatch for
 * wedged "N pending, 0 failed" queues.
 */
export async function retryAllMediaUploads(inspectionId?: string): Promise<number> {
  console.warn("[site-inspection-media] retryAllMediaUploads — clearing in-flight and restarting", {
    inspectionId: inspectionId ?? "(all)",
    priorInFlight: inFlight.size,
    priorActiveUploads: activeUploads,
    priorDraining: draining,
  });

  for (const abort of activeAbortByClientId.values()) {
    try {
      abort();
    } catch {
      /* ignore */
    }
  }
  activeAbortByClientId.clear();
  inFlight.clear();
  activeUploads = 0;
  draining = false;
  drainingStartedAt = 0;
  drainGeneration += 1;

  const items = await listAllItems();
  const targets = inspectionId ? items.filter((item) => item.inspectionId === inspectionId) : items;
  let reset = 0;
  const now = Date.now();
  for (const item of targets) {
    if (item.status === "uploaded") continue;
    cancelledUploads.delete(item.clientMediaId);
    const keepFinalizing = Boolean(item.storagePath);
    await putItem({
      ...item,
      status: keepFinalizing ? "finalizing" : "queued",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      progress: keepFinalizing ? 1 : 0,
      lastProgressAt: now,
    });
    reset += 1;
  }
  await emit();
  scheduleBackoffWakeup();
  void drainMediaQueue();
  return reset;
}

/**
 * Export every still-queued blob for an inspection so the inspector can save
 * copies to the device (and re-attach later if the queue stays wedged).
 */
export async function listQueuedMediaForDeviceExport(inspectionId: string): Promise<
  Array<{
    clientMediaId: string;
    mediaType: "photo" | "video";
    mimeType: string;
    filename: string;
    blob: Blob;
    status: QueueItemStatus;
  }>
> {
  const items = (await listAllItems()).filter((item) => item.inspectionId === inspectionId);
  const out: Array<{
    clientMediaId: string;
    mediaType: "photo" | "video";
    mimeType: string;
    filename: string;
    blob: Blob;
    status: QueueItemStatus;
  }> = [];
  for (const item of items) {
    if (item.status === "uploaded") continue;
    let blob: Blob;
    try {
      blob = blobForUpload(item);
    } catch (error) {
      console.error("[site-inspection-media] export skipped — missing blob", {
        clientMediaId: item.clientMediaId,
        error: formatUploadError(error),
      });
      continue;
    }
    const ext =
      item.mediaType === "video"
        ? item.mimeType.includes("quicktime") || item.mimeType.includes("mov")
          ? "mov"
          : "mp4"
        : item.mimeType.includes("png")
          ? "png"
          : "jpg";
    const short = item.clientMediaId.slice(0, 8);
    out.push({
      clientMediaId: item.clientMediaId,
      mediaType: item.mediaType,
      mimeType: item.mimeType,
      filename: `inspection-${item.mediaType}-${short}.${ext}`,
      blob,
      status: item.status,
    });
  }
  return out;
}

export function startMediaQueueDrain(options?: {
  onInspectionUpdate?: (inspection: SiteInspectionDetail) => void;
}): () => void {
  if (options?.onInspectionUpdate) {
    inspectionUpdateHandler = options.onInspectionUpdate;
  }
  void drainMediaQueue();
  scheduleBackoffWakeup();

  if (typeof window !== "undefined" && !drainPollTimer) {
    drainPollTimer = setInterval(() => {
      void (async () => {
        try {
          const snap = await getMediaQueueSnapshot();
          if (snap.stalledCount > 0) {
            console.warn("[site-inspection-media] stall watchdog", {
              stalledCount: snap.stalledCount,
              pendingCount: snap.pendingCount,
              failedCount: snap.failedCount,
              uploadingCount: snap.uploadingCount,
              inFlight: inFlight.size,
              activeUploads,
              draining,
            });
          }
          // Recover orphaned "uploading" rows whose processOne never finished
          // (e.g. tab freeze cleared timers but left inFlight empty after reload).
          void drainMediaQueue();
          scheduleBackoffWakeup();
        } catch (error) {
          console.warn("[site-inspection-media] drain poll error", {
            error: formatUploadError(error),
          });
        }
      })();
    }, DRAIN_POLL_INTERVAL_MS);
  }

  if (!onlineBound && typeof window !== "undefined") {
    onlineBound = true;
    const onOnline = () => {
      console.info("[site-inspection-media] online — restarting drain");
      void drainMediaQueue();
      scheduleBackoffWakeup();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      onlineBound = false;
      if (drainPollTimer) {
        clearInterval(drainPollTimer);
        drainPollTimer = null;
      }
      if (backoffWakeTimer) {
        clearTimeout(backoffWakeTimer);
        backoffWakeTimer = null;
      }
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
  if (!item) return;
  // Pending / uploading / finalizing must never be discarded via this path —
  // only explicit cancelAndDiscard (per-item delete) or inspection delete.
  if (item.status !== "failed") {
    console.warn("[site-inspection-media] discardMediaUpload refused — not failed", {
      clientMediaId,
      status: item.status,
    });
    throw new Error(
      "Only failed uploads can be discarded. Pending uploads are kept until they succeed — use Save queued media or Retry all.",
    );
  }
  await deleteItem(clientMediaId);
  await emit();
  // Best-effort: only affects rows that somehow exist (legacy orphans).
  await patchServerStatus(item.inspectionId, clientMediaId, "failed", null);
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
  input: Omit<MediaQueueItem, "blob"> & { blob?: Blob; bytes?: ArrayBuffer },
): Promise<void> {
  enableMemoryMediaQueueForTests();
  const blob =
    input.blob ??
    (input.bytes
      ? new Blob([input.bytes], { type: input.mimeType })
      : new Blob([new Uint8Array([1, 2, 3])], { type: input.mimeType }));
  await putItem({
    ...input,
    blob,
    byteSize: input.byteSize || blob.size,
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

  // Copy once off the live File into a fresh Blob (iOS invalidates input File handles).
  // Persist the Blob only — do not keep the intermediate ArrayBuffer on the queue item.
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
    lastProgressAt: now,
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

export {
  VIDEO_WARN_MESSAGE,
  MEDIA_UPLOAD_CONCURRENCY,
  LARGE_VIDEO_SERIAL_BYTES,
  TUS_CHUNK_SIZE_BYTES,
  VIDEO_MAX_BYTES,
} from "./media-limits";
export {
  normalizeAccessToken,
  redactAuthorizationForLog,
  redactApiKeyForLog,
  supabaseResumableUploadEndpoint,
} from "./media-limits";

/** Exported for unit tests — classify IndexedDB closing errors. */
export function isIdbClosingErrorForTests(error: unknown): boolean {
  return isIdbClosingError(error);
}
