/**
 * @vitest-environment jsdom
 *
 * Upload queue resilience: timeouts, retry-all escape hatch, stall watchdog,
 * export, and never auto-discard pending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QUEUE_STALL_WATCHDOG_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  discardMediaUpload,
  drainMediaQueue,
  enableMemoryMediaQueueForTests,
  fetchWithUploadTimeout,
  getMediaQueueSnapshot,
  listMediaQueueItemsForTests,
  listQueuedMediaForDeviceExport,
  purgeOrphanMediaQueueEntries,
  resetMediaQueueMemoryForTests,
  retryAllMediaUploads,
  seedMediaQueueItemForTests,
} from "@/lib/inspections/media-queue";

beforeEach(() => {
  resetMediaQueueMemoryForTests();
  enableMemoryMediaQueueForTests();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMediaQueueMemoryForTests();
});

async function seedQueued(id: string, status: "queued" | "uploading" | "failed" = "queued") {
  await seedMediaQueueItemForTests({
    clientMediaId: id,
    inspectionId: "insp-1",
    snapshotItemId: "item-1",
    mediaType: "video",
    mimeType: "video/mp4",
    byteSize: 4096,
    blob: new Blob([new Uint8Array(64)], { type: "video/mp4" }),
    status,
    attempts: status === "failed" ? 2 : 0,
    nextAttemptAt: status === "failed" ? Number.MAX_SAFE_INTEGER : 0,
    progress: status === "uploading" ? 0.1 : 0,
    lastError: status === "failed" ? "network" : null,
    storagePath: null,
    createdAt: Date.now() - QUEUE_STALL_WATCHDOG_MS - 5_000,
    lastProgressAt: Date.now() - QUEUE_STALL_WATCHDOG_MS - 5_000,
  });
}

describe("upload path timeouts", () => {
  it("documents hard timeouts on every upload network path", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(UPLOAD_STALL_TIMEOUT_MS).toBe(120_000);
    expect(UPLOAD_REQUEST_TIMEOUT_MS).toBe(90_000);
    expect(source).toContain("fetchWithUploadTimeout");
    expect(source).toContain("/media/prepare");
    expect(source).toContain("/media/complete");
    expect(source).toContain("/media/bytes");
    expect(source).toContain("Upload stalled with no progress");
    // prepare + complete + memory must use the timeout wrapper (not bare fetch).
    expect(source).toMatch(
      /fetchWithUploadTimeout\(\s*`\/api\/inspections\/\$\{item\.inspectionId\}\/media\/prepare`/,
    );
    expect(source).toMatch(
      /fetchWithUploadTimeout\(\s*`\/api\/inspections\/\$\{item\.inspectionId\}\/media\/complete`/,
    );
    expect(source).toContain("fetchWithUploadTimeout(");
    expect(source).toContain("Upload request timed out");
  });

  it("fetchWithUploadTimeout aborts a hung request into a terminal error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    await expect(fetchWithUploadTimeout("/hang", { method: "POST" }, 50)).rejects.toThrow(
      /timed out/i,
    );
  });
});

describe("retry all + wedge recovery", () => {
  it("retryAllMediaUploads clears in-flight markers and requeues every item", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "uploading");
    await seedQueued("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "queued");
    await seedQueued("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "failed");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: { message: "skip" } }), { status: 500 }),
      ),
    );

    const reset = await retryAllMediaUploads("insp-1");
    expect(reset).toBe(3);
    const items = await listMediaQueueItemsForTests();
    expect(items.every((i) => i.status === "queued")).toBe(true);
    const snap = await getMediaQueueSnapshot("insp-1");
    expect(snap.pendingCount).toBe(3);
    expect(snap.failedCount).toBe(0);
  });

  it("stall watchdog marks long-idle pending items", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "queued");
    const snap = await getMediaQueueSnapshot("insp-1");
    expect(snap.stalledCount).toBe(1);
    expect(snap.items[0]?.isStalled).toBe(true);
    expect(snap.items[0]?.statusReason).toMatch(/no progress|Retry all/i);
  });

  it("drain recovers after a wedged in-flight slot via retryAll", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "uploading");
    await seedQueued("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "queued");

    let prepareCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/prepare")) {
          prepareCalls += 1;
          return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 });
        }
        return new Response("{}", { status: 404 });
      }),
    );

    await retryAllMediaUploads("insp-1");
    await drainMediaQueue();
    await vi.waitFor(() => {
      expect(prepareCalls).toBeGreaterThan(0);
    });
  });
});

describe("pending uploads are never auto-discarded", () => {
  it("discardMediaUpload refuses non-failed items", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "queued");
    await expect(discardMediaUpload("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).rejects.toThrow(
      /only failed/i,
    );
    expect(await listMediaQueueItemsForTests()).toHaveLength(1);
  });

  it("orphan cleanup leaves valid pending rows for known inspections", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "queued");
    await seedMediaQueueItemForTests({
      clientMediaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      inspectionId: "deleted-insp",
      snapshotItemId: "item-1",
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 100,
      blob: new Blob([new Uint8Array(8)], { type: "image/jpeg" }),
      status: "queued",
      attempts: 0,
      nextAttemptAt: 0,
      progress: 0,
      lastError: null,
      storagePath: null,
      createdAt: Date.now(),
    });
    const removed = await purgeOrphanMediaQueueEntries(["insp-1"]);
    expect(removed).toBe(1);
    const remaining = await listMediaQueueItemsForTests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.inspectionId).toBe("insp-1");
  });

  it("runner leave warning no longer discards pending uploads", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(runner).toContain("will continue in the background");
    expect(runner).toContain("Nothing pending will be discarded");
    expect(runner).toContain("leaveInspectionKeepingQueue");
    expect(runner).not.toContain("Leaving discards unsent");
    expect(runner).not.toContain("leaveAndDiscardQueue");
    expect(runner).toContain("Retry all uploads");
    expect(runner).toContain("Save queued media to device");
    expect(runner).toContain("retryAllMediaUploads");
    expect(runner).toContain("listQueuedMediaForDeviceExport");
    // purge on leave removed — purge remains for inspection delete only.
    expect(runner).toContain("purgeMediaQueueForInspection");
  });
});

describe("save queued media to device", () => {
  it("exports all queued blobs as downloadable files", async () => {
    await seedQueued("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "queued");
    await seedQueued("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "failed");
    const files = await listQueuedMediaForDeviceExport("insp-1");
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.blob.size > 0)).toBe(true);
    expect(files.every((f) => f.filename.includes("inspection-video-"))).toBe(true);
  });
});
