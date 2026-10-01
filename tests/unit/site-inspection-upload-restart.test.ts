/**
 * @vitest-environment jsdom
 *
 * Completed uploads used to restart at 0% because a progress write snapshotted
 * the row, then waited on IndexedDB, and committed that snapshot after finalize
 * had deleted it. `setQueueCommitLagForTests` holds that same commit so the
 * race is deterministic. Without the per-entry lock the photo is PUT twice and
 * the second transfer starts at 0%.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  cancelAndDiscardMediaUpload,
  drainMediaQueue,
  getMediaQueueSnapshot,
  listMediaQueueItemsForTests,
  resetMediaQueueMemoryForTests,
  seedMediaQueueItemForTests,
  setQueueCommitLagForTests,
  subscribeMediaQueue,
} from "@/lib/inspections/media-queue";

const INSPECTION = "insp-access";
const ITEM = "item-access";
const VIDEO = "11111111-1111-4111-8111-111111111111";
const PHOTO = "22222222-2222-4222-8222-222222222222";

type ProgressEvent = { lengthComputable: boolean; loaded: number; total: number };

class FakeXHR {
  status = 200;
  responseText = "";
  url = "";
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  send() {
    const id = idFromUrl(this.url);
    const entry: SentUpload = { id, xhr: this, progressed: false, loaded: false };
    sent.push(entry);
    sendsById.set(id, (sendsById.get(id) ?? 0) + 1);
    startOrder.push(id);
    maxInFlight = Math.max(
      maxInFlight,
      sent.filter((row) => !row.loaded && !row.xhr.aborted).length,
    );
  }
}

type SentUpload = { id: string; xhr: FakeXHR; progressed: boolean; loaded: boolean };

let sent: SentUpload[] = [];
let sendsById = new Map<string, number>();
let startOrder: string[] = [];
let maxInFlight = 0;
let completeCalls: string[] = [];
let prepareCalls: string[] = [];
let failCompleteOnce = new Set<string>();
let holdComplete = false;
let completeWaiters: Array<{ id: string; resolve: (response: Response) => void }> = [];
let heldCommits: Array<() => void> = [];
let progressById = new Map<string, number[]>();
let unsubscribe: (() => void) | null = null;

function idFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function noteProgress(id: string, progress: number) {
  const list = progressById.get(id) ?? [];
  if (list[list.length - 1] !== progress) list.push(progress);
  progressById.set(id, list);
}

function assertProgressNeverRestarts(id: string) {
  const samples = progressById.get(id) ?? [];
  let reachedComplete = false;
  for (const sample of samples) {
    if (reachedComplete) {
      expect(
        sample,
        `${id} progress restarted after 100%: ${samples.join(",")}`,
      ).toBeGreaterThanOrEqual(1);
    }
    if (sample >= 1) reachedComplete = true;
  }
}

async function seedItem(input: {
  clientMediaId: string;
  mediaType: "photo" | "video";
  createdAt: number;
  byteSize: number;
}) {
  await seedMediaQueueItemForTests({
    clientMediaId: input.clientMediaId,
    inspectionId: INSPECTION,
    snapshotItemId: ITEM,
    mediaType: input.mediaType,
    mimeType: input.mediaType === "video" ? "video/mp4" : "image/jpeg",
    byteSize: input.byteSize,
    status: "queued",
    attempts: 0,
    nextAttemptAt: 0,
    progress: 0,
    lastError: null,
    storagePath: null,
    createdAt: input.createdAt,
    lastProgressAt: input.createdAt,
  });
}

async function releaseHeldCommits() {
  for (let i = 0; i < 12; i++) {
    if (!heldCommits.length) {
      await flush();
      if (!heldCommits.length) return;
    }
    const release = heldCommits.shift();
    release?.();
    await flush();
  }
}

async function driveSentUploads() {
  for (const entry of sent) {
    if (entry.xhr.aborted || entry.loaded) continue;
    if (!entry.progressed) {
      entry.progressed = true;
      entry.xhr.upload.onprogress?.({ lengthComputable: true, loaded: 0, total: 100 });
      entry.xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    }
  }
  await flush();
  for (const entry of sent) {
    if (entry.xhr.aborted || entry.loaded || !entry.progressed) continue;
    entry.loaded = true;
    entry.xhr.onload?.();
  }
  await flush();
  await releaseHeldCommits();
}

async function drainUntilSettled() {
  for (let i = 0; i < 30; i++) {
    await drainMediaQueue();
    await flush();
    await driveSentUploads();
    const pending = await listMediaQueueItemsForTests();
    const stillWorking = pending.some(
      (row) => row.status === "queued" || row.status === "uploading" || row.status === "finalizing",
    );
    const openTransfer = sent.some((row) => !row.loaded && !row.xhr.aborted);
    if (!stillWorking && !openTransfer && heldCommits.length === 0) return;
  }
  const leftover = await listMediaQueueItemsForTests();
  throw new Error(
    `queue did not settle: ${JSON.stringify(leftover)} sends=${JSON.stringify([...sendsById])}`,
  );
}

beforeEach(() => {
  sent = [];
  sendsById = new Map();
  startOrder = [];
  maxInFlight = 0;
  completeCalls = [];
  prepareCalls = [];
  failCompleteOnce = new Set();
  holdComplete = false;
  completeWaiters = [];
  heldCommits = [];
  progressById = new Map();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  resetEnvCacheForTests();
  resetMediaQueueMemoryForTests();
  setQueueCommitLagForTests(async (item) => {
    if (item.status === "uploading" && item.progress >= 1) {
      await new Promise<void>((resolve) => {
        heldCommits.push(resolve);
      });
    }
  });
  unsubscribe = subscribeMediaQueue((snapshot) => {
    for (const item of snapshot.items) noteProgress(item.clientMediaId, item.progress);
  });
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as { clientMediaId?: string }) : {};
    const clientMediaId = body.clientMediaId ?? "";
    if (url.includes("/media/prepare")) {
      prepareCalls.push(clientMediaId);
      return jsonResponse({
        upload: {
          mode: "signed",
          path: `user/${INSPECTION}/${clientMediaId}`,
          token: "token",
          signedUrl: `https://example.supabase.co/upload/${clientMediaId}`,
        },
      });
    }
    if (url.includes("/media/complete")) {
      completeCalls.push(clientMediaId);
      if (failCompleteOnce.has(clientMediaId)) {
        failCompleteOnce.delete(clientMediaId);
        return jsonResponse({ error: { message: "complete failed" } }, 500);
      }
      if (holdComplete) {
        return new Promise<Response>((resolve) => {
          completeWaiters.push({ id: clientMediaId, resolve });
        });
      }
      return jsonResponse({ inspection: { id: INSPECTION, media: [] } });
    }
    return jsonResponse({ error: { message: "unexpected" } }, 404);
  });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  for (const release of heldCommits) release();
  heldCommits = [];
  for (const waiter of completeWaiters) {
    waiter.resolve(jsonResponse({ inspection: { id: INSPECTION, media: [] } }));
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMediaQueueMemoryForTests();
});

describe("completed uploads must not restart", () => {
  it("does not restart a photo that finishes while a large video is queued on the same item", async () => {
    await seedItem({
      clientMediaId: VIDEO,
      mediaType: "video",
      createdAt: 1_000,
      byteSize: 25 * 1024 * 1024,
    });
    await seedItem({
      clientMediaId: PHOTO,
      mediaType: "photo",
      createdAt: 2_000,
      byteSize: 1200,
    });

    await drainUntilSettled();

    expect(sendsById.get(PHOTO)).toBe(1);
    expect(sendsById.get(VIDEO)).toBe(1);
    expect(prepareCalls.filter((id) => id === PHOTO)).toHaveLength(1);
    expect(completeCalls.filter((id) => id === PHOTO)).toEqual([PHOTO]);
    expect(startOrder).toEqual([VIDEO, PHOTO]);
    expect(maxInFlight).toBe(1);
    assertProgressNeverRestarts(PHOTO);
    assertProgressNeverRestarts(VIDEO);
    expect(await listMediaQueueItemsForTests()).toHaveLength(0);
  });

  it("finishes several photos queued in succession without a second PUT", async () => {
    const ids = ["photo-a", "photo-b", "photo-c"];
    for (let i = 0; i < ids.length; i++) {
      await seedItem({
        clientMediaId: ids[i]!,
        mediaType: "photo",
        createdAt: 1_000 + i,
        byteSize: 800 + i,
      });
    }

    await drainUntilSettled();

    expect(startOrder).toEqual(ids);
    expect(maxInFlight).toBe(1);
    for (const id of ids) {
      expect(sendsById.get(id)).toBe(1);
      expect(completeCalls.filter((call) => call === id)).toEqual([id]);
      assertProgressNeverRestarts(id);
    }
  });

  it("uploads one video and several photos on the same item, strictly in order", async () => {
    await seedItem({
      clientMediaId: VIDEO,
      mediaType: "video",
      createdAt: 1_000,
      byteSize: 40 * 1024 * 1024,
    });
    await seedItem({
      clientMediaId: PHOTO,
      mediaType: "photo",
      createdAt: 2_000,
      byteSize: 500,
    });
    await seedItem({
      clientMediaId: "photo-late",
      mediaType: "photo",
      createdAt: 3_000,
      byteSize: 700,
    });

    await drainUntilSettled();

    expect(startOrder).toEqual([VIDEO, PHOTO, "photo-late"]);
    expect(maxInFlight).toBe(1);
    expect(completeCalls).toEqual([VIDEO, PHOTO, "photo-late"]);
    for (const id of [VIDEO, PHOTO, "photo-late"]) {
      expect(sendsById.get(id)).toBe(1);
      assertProgressNeverRestarts(id);
    }
  });

  it("shows finalizing as its own state before the server confirms", async () => {
    holdComplete = true;
    await seedItem({
      clientMediaId: PHOTO,
      mediaType: "photo",
      createdAt: 1_000,
      byteSize: 900,
    });

    const seen: string[] = [];
    const stop = subscribeMediaQueue((snapshot) => {
      const row = snapshot.items.find((item) => item.clientMediaId === PHOTO);
      if (row) seen.push(row.statusReason);
    });

    await drainMediaQueue();
    await flush();
    await driveSentUploads();
    await flush();

    const snap = await getMediaQueueSnapshot(INSPECTION);
    const row = snap.items.find((item) => item.clientMediaId === PHOTO);
    expect(row?.status).toBe("finalizing");
    expect(row?.statusReason).toBe("Finalizing on server…");
    expect(row?.progress).toBe(1);
    expect(seen).toContain("Finalizing on server…");
    expect(seen.some((reason) => reason.startsWith("Uploading"))).toBe(true);
    expect(sendsById.get(PHOTO)).toBe(1);

    holdComplete = false;
    const waiter = completeWaiters.shift();
    waiter?.resolve(jsonResponse({ inspection: { id: INSPECTION, media: [] } }));
    await flush();
    expect(await listMediaQueueItemsForTests()).toHaveLength(0);
    stop();
  });

  it("retries a failed finalize without uploading the bytes again", async () => {
    failCompleteOnce.add(PHOTO);
    await seedItem({
      clientMediaId: PHOTO,
      mediaType: "photo",
      createdAt: 1_000,
      byteSize: 900,
    });

    await drainMediaQueue();
    await flush();
    await driveSentUploads();
    await flush();

    const failed = (await listMediaQueueItemsForTests()).find((row) => row.clientMediaId === PHOTO);
    expect(failed?.status).toBe("finalizing");
    expect(failed?.storagePath).toContain(PHOTO);
    expect(failed?.progress).toBe(1);
    expect(sendsById.get(PHOTO)).toBe(1);
    expect(prepareCalls.filter((id) => id === PHOTO)).toHaveLength(1);

    const snap = await getMediaQueueSnapshot(INSPECTION);
    const reason = snap.items.find((item) => item.clientMediaId === PHOTO)?.statusReason ?? "";
    expect(reason).toContain("Finalize failed");
    expect(reason).toContain("complete failed");

    await vi.waitFor(
      async () => {
        if (completeCalls.filter((id) => id === PHOTO).length < 2) {
          throw new Error("finalize has not been retried");
        }
      },
      { timeout: 8_000, interval: 50 },
    );

    expect(sendsById.get(PHOTO)).toBe(1);
    expect(prepareCalls.filter((id) => id === PHOTO)).toHaveLength(1);
    expect(completeCalls.filter((id) => id === PHOTO)).toEqual([PHOTO, PHOTO]);
    expect(await listMediaQueueItemsForTests()).toHaveLength(0);
    assertProgressNeverRestarts(PHOTO);
  });

  it("cancels only the in-flight entry and still uploads the next one", async () => {
    await seedItem({
      clientMediaId: PHOTO,
      mediaType: "photo",
      createdAt: 1_000,
      byteSize: 400,
    });
    await seedItem({
      clientMediaId: "photo-next",
      mediaType: "photo",
      createdAt: 2_000,
      byteSize: 400,
    });

    await drainMediaQueue();
    await vi.waitFor(() => {
      if (!sent.some((row) => row.id === PHOTO)) throw new Error("photo has not started");
    });
    expect(sent.some((row) => row.id === "photo-next")).toBe(false);

    await cancelAndDiscardMediaUpload(PHOTO);
    await flush();

    await drainUntilSettled();

    expect(sendsById.get(PHOTO)).toBe(1);
    expect(sendsById.get("photo-next")).toBe(1);
    expect(completeCalls).toEqual(["photo-next"]);
    expect(await listMediaQueueItemsForTests()).toHaveLength(0);
  });
});
