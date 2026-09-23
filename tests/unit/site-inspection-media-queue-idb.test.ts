/**
 * Media queue: Blob-backed IDB storage, connection reopen, stall timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UPLOAD_STALL_TIMEOUT_MS,
  enableMemoryMediaQueueForTests,
  enqueueInspectionMedia,
  isIdbClosingErrorForTests,
  listMediaQueueItemsForTests,
  resetMediaQueueMemoryForTests,
  seedMediaQueueItemForTests,
} from "@/lib/inspections/media-queue";

beforeEach(() => {
  resetMediaQueueMemoryForTests();
  enableMemoryMediaQueueForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetMediaQueueMemoryForTests();
});

describe("media queue IndexedDB / storage strategy", () => {
  it("classifies connection-closing errors for reopen retry", () => {
    expect(
      isIdbClosingErrorForTests(
        new DOMException(
          "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
          "InvalidStateError",
        ),
      ),
    ).toBe(true);
    expect(isIdbClosingErrorForTests(new Error("network failed"))).toBe(false);
  });

  it("persists Blob-only queue rows without resident ArrayBuffers", async () => {
    // ~2 MB payload — meaningful size, not a tiny fixture.
    const payload = new Uint8Array(2 * 1024 * 1024);
    payload.fill(7);
    const file = new File([payload], "clip.mp4", { type: "video/mp4" });

    // Prevent drain from hitting the network during enqueue.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: { message: "skip" } }), { status: 500 }),
      ),
    );

    const result = await enqueueInspectionMedia({
      inspectionId: "insp-1",
      snapshotItemId: "item-1",
      file,
      mediaType: "video",
    });

    const items = await listMediaQueueItemsForTests();
    const row = items.find((i) => i.clientMediaId === result.clientMediaId);
    expect(row?.byteSize).toBe(payload.byteLength);
    expect(row?.hasBlob).toBe(true);
  });

  it("documents a stall timeout that covers uploading 0%", () => {
    expect(UPLOAD_STALL_TIMEOUT_MS).toBe(120_000);
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(source).toContain("Upload stalled with no progress");
    expect(source).toContain("lastActivityAt = Date.now()");
    expect(source).toContain("xhr.send(blob)");
  });

  it("seeds video blobs without requiring ArrayBuffer on the item", async () => {
    const big = new Uint8Array(512 * 1024);
    big.fill(3);
    await seedMediaQueueItemForTests({
      clientMediaId: "c1",
      inspectionId: "i1",
      snapshotItemId: "s1",
      mediaType: "video",
      mimeType: "video/mp4",
      byteSize: big.byteLength,
      blob: new Blob([big], { type: "video/mp4" }),
      status: "queued",
      attempts: 0,
      nextAttemptAt: 0,
      progress: 0,
      lastError: null,
      storagePath: null,
      createdAt: Date.now(),
    });
    const items = await listMediaQueueItemsForTests();
    expect(items).toHaveLength(1);
    expect(items[0]?.byteSize).toBe(big.byteLength);
  });
});
