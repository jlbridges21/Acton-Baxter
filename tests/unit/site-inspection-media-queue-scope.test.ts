/**
 * @vitest-environment jsdom
 *
 * Media upload queue must be scoped per inspection, purge on delete/leave,
 * and clean orphans — without discarding on background/reload/offline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countPendingForInspection,
  getMediaQueueSnapshot,
  listMediaQueueItemsForTests,
  purgeMediaQueueForInspection,
  purgeOrphanMediaQueueEntries,
  resetMediaQueueMemoryForTests,
  seedMediaQueueItemForTests,
  startMediaQueueDrain,
  subscribeMediaQueue,
  enableMemoryMediaQueueForTests,
} from "@/lib/inspections/media-queue";

beforeEach(() => {
  resetMediaQueueMemoryForTests();
  enableMemoryMediaQueueForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMediaQueueMemoryForTests();
});

async function seed(
  inspectionId: string,
  clientMediaId: string,
  status: "queued" | "failed" | "uploading",
) {
  await seedMediaQueueItemForTests({
    clientMediaId,
    inspectionId,
    snapshotItemId: "item-1",
    mediaType: "video",
    mimeType: "video/mp4",
    byteSize: 1024,
    status,
    attempts: status === "failed" ? 3 : 0,
    nextAttemptAt: status === "failed" ? Number.MAX_SAFE_INTEGER : 0,
    progress: 0,
    lastError: status === "failed" ? "network" : null,
    storagePath: null,
    createdAt: Date.now(),
  });
}

describe("media queue inspection scoping", () => {
  it("entries are tagged with inspectionId and counters filter to one inspection", async () => {
    await seed("insp-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "failed");
    await seed("insp-a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "queued");
    await seed("insp-b", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "failed");
    await seed("insp-b", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "failed");

    const snapA = await getMediaQueueSnapshot("insp-a");
    expect(snapA.pendingCount).toBe(1);
    expect(snapA.failedCount).toBe(1);
    expect(snapA.items.every((i) => i.inspectionId === "insp-a")).toBe(true);

    const snapB = await getMediaQueueSnapshot("insp-b");
    expect(snapB.pendingCount).toBe(0);
    expect(snapB.failedCount).toBe(2);

    const countsNew = await countPendingForInspection("insp-new");
    expect(countsNew).toEqual({ pending: 0, failed: 0 });
  });

  it("subscribeMediaQueue emits only the scoped inspection's counts", async () => {
    await seed("insp-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "failed");
    await seed("insp-b", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "failed");
    await seed("insp-b", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "queued");

    const seen: Array<{ pending: number; failed: number }> = [];
    const unsub = subscribeMediaQueue(
      (snap) => {
        seen.push({ pending: snap.pendingCount, failed: snap.failedCount });
      },
      { inspectionId: "insp-a" },
    );
    await vi.waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
    });
    expect(seen[seen.length - 1]).toEqual({ pending: 0, failed: 1 });
    unsub();
  });

  it("failed counter does not invent duplicate rows — retries update the same clientMediaId", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await seed("insp-a", id, "failed");
    await seedMediaQueueItemForTests({
      clientMediaId: id,
      inspectionId: "insp-a",
      snapshotItemId: "item-1",
      mediaType: "video",
      mimeType: "video/mp4",
      byteSize: 2048,
      status: "failed",
      attempts: 4,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      progress: 0.2,
      lastError: "retry update",
      storagePath: null,
      createdAt: Date.now(),
    });
    const all = await listMediaQueueItemsForTests();
    expect(all.filter((i) => i.clientMediaId === id)).toHaveLength(1);
    const snap = await getMediaQueueSnapshot("insp-a");
    expect(snap.failedCount).toBe(1);
  });
});

describe("purge on delete / leave / orphans", () => {
  it("purgeMediaQueueForInspection removes rows and blobs from the store", async () => {
    await seed("insp-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "failed");
    await seed("insp-a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "queued");
    await seed("insp-b", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "failed");

    const removed = await purgeMediaQueueForInspection("insp-a");
    expect(removed).toBe(2);
    const remaining = await listMediaQueueItemsForTests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.inspectionId).toBe("insp-b");
    expect(remaining[0]!.hasBlob).toBe(true);
  });

  it("orphan cleanup drops entries for inspections that no longer exist", async () => {
    await seed("gone-insp", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "failed");
    await seed("gone-insp", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "uploading");
    await seed("alive-insp", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "queued");

    const removed = await purgeOrphanMediaQueueEntries(["alive-insp"]);
    expect(removed).toBe(2);
    const remaining = await listMediaQueueItemsForTests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.inspectionId).toBe("alive-insp");
  });
});

describe("background / offline resilience preserved", () => {
  it("reload / offline does not call purge — only explicit purge APIs remove rows", async () => {
    await seed("insp-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "queued");
    await seed("insp-a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "failed");

    // Simulate page remount: new subscription + drain start, no purge.
    const stop = startMediaQueueDrain();
    const snap = await getMediaQueueSnapshot("insp-a");
    expect(snap.pendingCount).toBe(1);
    expect(snap.failedCount).toBe(1);
    expect(await listMediaQueueItemsForTests()).toHaveLength(2);
    stop();
  });

  it("drain on reconnect is still wired (online listener + drainMediaQueue)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(source).toContain('window.addEventListener("online"');
    expect(source).toContain("void drainMediaQueue()");
    expect(source).toContain("uploadSigned");
    expect(source).not.toContain("purgeMediaQueueForInspection(inspection.id);\n  void drain");
  });
});

describe("runner wiring", () => {
  it("scopes subscribe, purges on delete/leave, and warns that leave discards unsent media", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(runner).toContain("{ inspectionId: inspection.id }");
    expect(runner).toContain("purgeMediaQueueForInspection");
    expect(runner).toContain("purgeOrphanMediaQueueEntries");
    expect(runner).toContain("Leaving discards unsent photos and videos");
    expect(runner).toContain("leaveAndDiscardQueue");

    const list = readFileSync(
      join(process.cwd(), "src/components/inspections/inspections-list-client.tsx"),
      "utf8",
    );
    expect(list).toContain("purgeMediaQueueForInspection");
  });
});
