/**
 * @vitest-environment jsdom
 *
 * Regression: rapid checklist toggles must not revert when an earlier save ack
 * returns. The old runner applied `json.inspection` after each PATCH, wiping
 * newer optimistic edits (stale-write race).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearAllPendingResponses,
  clearPendingResponse,
  getPendingResponse,
  listPendingResponses,
  queuePendingResponse,
} from "@/lib/inspections/client-autosave";
import { flushPendingResponses, shouldClearPendingAfterAck } from "@/lib/inspections/response-sync";

const INSPECTION_ID = "insp-race-1";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  clearAllPendingResponses(INSPECTION_ID);
  localStorage.clear();
});

afterEach(() => {
  clearAllPendingResponses(INSPECTION_ID);
  localStorage.clear();
  vi.useRealTimers();
});

describe("shouldClearPendingAfterAck", () => {
  it("keeps pending when a newer local edit superseded the in-flight payload", () => {
    expect(shouldClearPendingAfterAck("2026-01-01T00:00:02.000Z", "2026-01-01T00:00:01.000Z")).toBe(
      false,
    );
  });

  it("clears only when the ack matches the sent revision", () => {
    expect(shouldClearPendingAfterAck("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:01.000Z")).toBe(
      true,
    );
  });
});

describe("rapid checkbox race (stale-write)", () => {
  /**
   * Replays the OLD buggy reconciliation: after each save, replace local
   * completeness from the server snapshot captured at request time. This must
   * lose the second toggle — proving the regression target.
   */
  it("OLD behavior: in-flight save ack reverts a newer checkbox toggle", async () => {
    const localComplete = new Map<string, boolean>();
    localComplete.set(ITEM_A, true);
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      isComplete: true,
      updatedAt: "t1",
    });

    let resolveA!: (v: { snapshotItemId: string; isComplete: boolean }) => void;
    const saveA = new Promise<{ snapshotItemId: string; isComplete: boolean }>((r) => {
      resolveA = r;
    });

    // Start "flush" for A only (snapshot at flush start).
    const pendingAtFlushStart = listPendingResponses(INSPECTION_ID);
    const flushPromise = (async () => {
      let lastServer: { snapshotItemId: string; isComplete: boolean } | null = null;
      for (const patch of pendingAtFlushStart) {
        if (patch.snapshotItemId === ITEM_A) {
          lastServer = await saveA;
        }
        // BUG: clear unconditionally + apply server world
        clearPendingResponse(INSPECTION_ID, patch.snapshotItemId);
      }
      if (lastServer) {
        // BUG: rehydrate local from ack
        localComplete.set(lastServer.snapshotItemId, lastServer.isComplete);
        // Server never saw B — wipe it if we naively replace from full inspection:
        localComplete.delete(ITEM_B);
      }
    })();

    // While A is in flight, toggle B.
    localComplete.set(ITEM_B, true);
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_B,
      isComplete: true,
      updatedAt: "t2",
    });

    resolveA({ snapshotItemId: ITEM_A, isComplete: true });
    await flushPromise;

    expect(localComplete.get(ITEM_A)).toBe(true);
    // Stale ack wiped B — this is the field bug.
    expect(localComplete.get(ITEM_B)).toBeUndefined();
  });

  it("NEW behavior: rapid toggles across items all persist; save acks never rewrite local", async () => {
    const localComplete = new Map<string, boolean>();
    const serverComplete = new Map<string, boolean>();

    const deferred = new Map<string, { resolve: () => void; promise: Promise<void> }>();
    function gate(id: string) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      deferred.set(id, { resolve, promise });
      return deferred.get(id)!;
    }

    const gateA = gate(ITEM_A);
    const gateB = gate(ITEM_B);
    const gateC = gate(ITEM_C);

    async function saveItem(body: {
      snapshotItemId: string;
      isComplete?: boolean;
      notes?: string;
      answers?: Record<string, { type: string; value: string | string[] | null }>;
    }) {
      const g = deferred.get(body.snapshotItemId);
      if (g) await g.promise;
      if (body.isComplete !== undefined) {
        serverComplete.set(body.snapshotItemId, body.isComplete);
      }
      // Intentionally do NOT touch localComplete — ack is persistence-only.
    }

    // Toggle A, start flush (will block on gate A).
    localComplete.set(ITEM_A, true);
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      isComplete: true,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });

    const flush1 = flushPendingResponses({ inspectionId: INSPECTION_ID, saveItem });

    // While A is in flight, toggle B and C rapidly.
    localComplete.set(ITEM_B, true);
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_B,
      isComplete: true,
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    localComplete.set(ITEM_C, true);
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_C,
      isComplete: true,
      updatedAt: "2026-01-01T00:00:03.000Z",
    });

    // Local UI never reverted.
    expect(localComplete.get(ITEM_A)).toBe(true);
    expect(localComplete.get(ITEM_B)).toBe(true);
    expect(localComplete.get(ITEM_C)).toBe(true);

    gateA.resolve();
    gateB.resolve();
    gateC.resolve();
    const result = await flush1;

    expect(result).toBe("saved");
    expect(serverComplete.get(ITEM_A)).toBe(true);
    expect(serverComplete.get(ITEM_B)).toBe(true);
    expect(serverComplete.get(ITEM_C)).toBe(true);
    expect(localComplete.get(ITEM_A)).toBe(true);
    expect(localComplete.get(ITEM_B)).toBe(true);
    expect(localComplete.get(ITEM_C)).toBe(true);
    expect(listPendingResponses(INSPECTION_ID)).toHaveLength(0);
  });

  it("NEW behavior: same-field supersede keeps the latest toggle, not the in-flight value", async () => {
    const serverComplete = new Map<string, boolean>();
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      resolveFirst = r;
    });
    let saveCount = 0;

    async function saveItem(body: { snapshotItemId: string; isComplete?: boolean }) {
      saveCount += 1;
      if (saveCount === 1) await firstGate;
      if (body.isComplete !== undefined) {
        serverComplete.set(body.snapshotItemId, body.isComplete);
      }
    }

    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      isComplete: true,
      updatedAt: "t1",
    });

    const flushPromise = flushPendingResponses({ inspectionId: INSPECTION_ID, saveItem });

    // While first save is in flight, uncheck (supersede).
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      isComplete: false,
      updatedAt: "t2",
    });

    resolveFirst();
    const result = await flushPromise;

    expect(result).toBe("saved");
    expect(serverComplete.get(ITEM_A)).toBe(false);
    expect(getPendingResponse(INSPECTION_ID, ITEM_A)).toBeUndefined();
  });

  it("NEW behavior: interleaved checkbox, notes, and sub-question all persist", async () => {
    const server = new Map<
      string,
      {
        isComplete?: boolean;
        notes?: string;
        answers?: Record<string, { type: string; value: string | string[] | null }>;
      }
    >();

    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;

    async function saveItem(body: {
      snapshotItemId: string;
      isComplete?: boolean;
      notes?: string;
      answers?: Record<string, { type: string; value: string | string[] | null }>;
    }) {
      calls += 1;
      if (calls === 1) await hold;
      const prev = server.get(body.snapshotItemId) ?? {};
      server.set(body.snapshotItemId, {
        isComplete: body.isComplete !== undefined ? body.isComplete : prev.isComplete,
        notes: body.notes !== undefined ? body.notes : prev.notes,
        answers: body.answers ? { ...(prev.answers ?? {}), ...body.answers } : prev.answers,
      });
    }

    const subId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      isComplete: true,
      updatedAt: "t1",
    });

    const flushPromise = flushPendingResponses({ inspectionId: INSPECTION_ID, saveItem });

    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      notes: "rear setback clear",
      updatedAt: "t2",
    });
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_A,
      answers: { [subId]: { type: "text", value: "ok" } },
      updatedAt: "t3",
    });
    queuePendingResponse(INSPECTION_ID, {
      snapshotItemId: ITEM_B,
      isComplete: true,
      updatedAt: "t4",
    });

    release();
    expect(await flushPromise).toBe("saved");

    expect(server.get(ITEM_A)).toEqual({
      isComplete: true,
      notes: "rear setback clear",
      answers: { [subId]: { type: "text", value: "ok" } },
    });
    expect(server.get(ITEM_B)?.isComplete).toBe(true);
  });
});

describe("runner source lock", () => {
  it("never rehydrates checklist responses from a save ack", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(source).toContain("flushPendingResponses");
    expect(source).toContain("Ack only");
    expect(source).toContain("applyServerMediaOnly");
    expect(source).not.toContain("applyServerInspection");
    expect(source).not.toMatch(/if \(last\) applyServer/);
  });
});
