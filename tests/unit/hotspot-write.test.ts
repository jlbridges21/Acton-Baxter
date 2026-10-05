import { describe, expect, it } from "vitest";
import {
  HotspotDraftController,
  commitHotspotWrite,
  createHotspotWriteQueue,
} from "@/lib/tours/hotspot-draft";
import {
  hotspotWriteRow,
  writeHotspotIdempotently,
  type HotspotRowStore,
  type HotspotWriteRow,
} from "@/lib/tours/hotspot-write";
import type { ViewerHotspot } from "@/lib/tours/viewer-model";

function hotspot(partial: Partial<ViewerHotspot> & Pick<ViewerHotspot, "id">): ViewerHotspot {
  return {
    type: "link",
    yaw: 0,
    pitch: 0,
    label: null,
    content: null,
    targetSceneId: null,
    styleShape: "arrow",
    styleColor: "#FFFFFF",
    styleSize: 48,
    styleRotation: 0,
    stylePlacement: "billboard",
    ...partial,
  };
}

function memoryStore() {
  const rows = new Map<string, HotspotWriteRow>();
  const operations: Array<"insert" | "update"> = [];
  const store: HotspotRowStore = {
    async findSceneId(id) {
      return rows.get(id)?.scene_id ?? null;
    },
    async write(row) {
      operations.push(rows.has(row.id) ? "update" : "insert");
      rows.set(row.id, { ...row });
    },
  };
  return { rows, operations, store };
}

const sceneId = "22222222-2222-4222-8222-222222222222";

function row(partial: Partial<HotspotWriteRow> = {}): HotspotWriteRow {
  return hotspotWriteRow({
    id: "33333333-3333-4333-8333-333333333333",
    sceneId,
    targetSceneId: null,
    type: "link",
    yaw: 0.2,
    pitch: 0.1,
    label: null,
    content: null,
    styleShape: "arrow",
    styleColor: "#FFFFFF",
    styleSize: 48,
    styleRotation: 0,
    stylePlacement: "billboard",
    ...partial,
  });
}

describe("idempotent hotspot write", () => {
  it("replays the same payload as one row", async () => {
    const { rows, store, operations } = memoryStore();
    const payload = row();
    const first = await writeHotspotIdempotently(store, payload);
    const second = await writeHotspotIdempotently(store, payload);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(rows.size).toBe(1);
    expect(operations).toEqual(["insert", "update"]);
    expect(rows.get(payload.id)).toEqual(payload);
  });

  it("succeeds when a failed write is retried after the row already exists", async () => {
    const { rows, store } = memoryStore();
    const payload = row();
    let attempts = 0;
    const flaky: HotspotRowStore = {
      findSceneId: (id) => store.findSceneId(id),
      write: async (next) => {
        attempts += 1;
        await store.write(next);
        if (attempts === 1) throw new Error("timeout");
      },
    };
    const failed = await writeHotspotIdempotently(flaky, payload);
    expect(failed.error).toBe("timeout");
    expect(rows.size).toBe(1);
    const retried = await writeHotspotIdempotently(flaky, {
      ...payload,
      yaw: 1.25,
      style_shape: "circle",
    });
    expect(retried.error).toBeNull();
    expect(rows.size).toBe(1);
    expect(rows.get(payload.id)).toMatchObject({ yaw: 1.25, style_shape: "circle" });
  });

  it("writes again after a primary-key conflict", async () => {
    const rows = new Map<string, HotspotWriteRow>();
    let conflicted = false;
    const store: HotspotRowStore = {
      async findSceneId(id) {
        return rows.get(id)?.scene_id ?? null;
      },
      async write(next) {
        const duplicate = rows.has(next.id) && !conflicted;
        rows.set(next.id, { ...next });
        if (duplicate) {
          conflicted = true;
          const error = new Error('duplicate key value violates unique constraint "hotspots_pkey"');
          (error as { code?: string }).code = "23505";
          throw error;
        }
      },
    };
    const payload = row();
    expect((await writeHotspotIdempotently(store, payload)).error).toBeNull();
    const again = await writeHotspotIdempotently(store, { ...payload, pitch: -0.4 });
    expect(again.error).toBeNull();
    expect(rows.size).toBe(1);
    expect(rows.get(payload.id)?.pitch).toBe(-0.4);
  });

  it("rejects a hotspot that already belongs to another scene", async () => {
    let writes = 0;
    const store: HotspotRowStore = {
      async findSceneId() {
        return "99999999-9999-4999-8999-999999999999";
      },
      async write() {
        writes += 1;
      },
    };
    const result = await writeHotspotIdempotently(store, row());
    expect(result.error).toBe("That hotspot was not found.");
    expect(writes).toBe(0);
  });

  it("surfaces a real write failure", async () => {
    let calls = 0;
    const store: HotspotRowStore = {
      async findSceneId() {
        return null;
      },
      async write() {
        calls += 1;
        throw new Error("permission denied");
      },
    };
    const result = await writeHotspotIdempotently(store, row());
    expect(result.error).toBe("permission denied");
    expect(calls).toBe(1);
  });
});

describe("hotspot save interleaving", () => {
  it("keeps the later edit when the first write resolves stale", async () => {
    const draft = new HotspotDraftController();
    const scenes = [{ id: "scene", hotspots: [] as ViewerHotspot[] }];
    draft.syncServer(scenes);
    const queue = createHotspotWriteQueue();
    const { rows, operations, store } = memoryStore();
    const placed = hotspot({ id: "hotspot", yaw: 0.2, pitch: 0.1, styleShape: "arrow" });
    draft.place("scene", placed);

    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started: () => void = () => undefined;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    let saves = 0;

    let settled: { resave: boolean } = { resave: false };
    const persist = async () => {
      const outcome = await commitHotspotWrite({
        controller: draft,
        sceneId: "scene",
        hotspotId: placed.id,
        save: async (latest) => {
          saves += 1;
          if (saves === 1) {
            started();
            await firstGate;
          }
          return writeHotspotIdempotently(
            store,
            hotspotWriteRow({
              id: latest.id,
              sceneId,
              targetSceneId: latest.targetSceneId,
              type: latest.type,
              yaw: latest.yaw,
              pitch: latest.pitch,
              label: latest.label,
              content: latest.content,
              styleShape: latest.styleShape,
              styleColor: latest.styleColor,
              styleSize: latest.styleSize,
              styleRotation: latest.styleRotation,
              stylePlacement: latest.stylePlacement,
            }),
          );
        },
        remove: async () => ({ error: null }),
      });
      settled = outcome;
      if (outcome.resave) void queue.enqueue(placed.id, persist);
    };

    const first = queue.enqueue(placed.id, persist);
    await startedGate;
    const edited = { ...placed, yaw: 1.7, pitch: -0.4, styleShape: "circle" as const };
    draft.patch("scene", edited);
    releaseFirst();
    await first;
    expect(settled.resave).toBe(true);
    expect(draft.rowExists(placed.id)).toBe(true);
    expect(draft.saved[placed.id]).toBeUndefined();
    expect(operations).toEqual(["insert"]);

    await queue.enqueue(placed.id, async () => undefined);
    expect(operations).toEqual(["insert", "update"]);
    expect(rows.size).toBe(1);
    expect(rows.get(placed.id)).toMatchObject({ yaw: 1.7, pitch: -0.4, style_shape: "circle" });
    expect(JSON.parse(draft.saved[placed.id] ?? "{}")).toMatchObject({
      yaw: 1.7,
      styleShape: "circle",
    });
    expect(draft.isDirty(scenes)).toBe(false);
  });

  it("does not delete a hotspot that was never persisted and does delete one that was", async () => {
    const draft = new HotspotDraftController();
    const fresh = hotspot({ id: "fresh", yaw: 0.3, pitch: 0 });
    draft.syncServer([{ id: "scene", hotspots: [] }]);
    draft.place("scene", fresh);
    draft.remove("scene", fresh.id);
    let removedFresh = false;
    const skipped = await commitHotspotWrite({
      controller: draft,
      sceneId: "scene",
      hotspotId: fresh.id,
      save: async () => ({ error: "should not save" }),
      remove: async () => {
        removedFresh = true;
        return { error: null };
      },
    });
    expect(skipped.skipped).toBe(true);
    expect(skipped.error).toBeNull();
    expect(removedFresh).toBe(false);

    const existing = hotspot({ id: "kept", yaw: 0.5, pitch: 0.2 });
    draft.syncServer([{ id: "scene", hotspots: [existing] }]);
    expect(draft.rowExists(existing.id)).toBe(true);
    draft.remove("scene", existing.id);
    let removedKept = false;
    const deleted = await commitHotspotWrite({
      controller: draft,
      sceneId: "scene",
      hotspotId: existing.id,
      save: async () => ({ error: "should not save" }),
      remove: async () => {
        removedKept = true;
        return { error: null };
      },
    });
    expect(deleted.skipped).toBe(false);
    expect(deleted.error).toBeNull();
    expect(removedKept).toBe(true);
    expect(draft.rowExists(existing.id)).toBe(false);
  });

  it("returns a real save error without marking the row", async () => {
    const draft = new HotspotDraftController();
    draft.syncServer([{ id: "scene", hotspots: [] }]);
    const placed = hotspot({ id: "hotspot", yaw: 0.4, pitch: 0 });
    draft.place("scene", placed);
    const result = await commitHotspotWrite({
      controller: draft,
      sceneId: "scene",
      hotspotId: placed.id,
      save: async () => ({ error: "Could not save the hotspot." }),
      remove: async () => ({ error: null }),
    });
    expect(result.error).toBe("Could not save the hotspot.");
    expect(result.resave).toBe(false);
    expect(draft.rowExists(placed.id)).toBe(false);
    expect(draft.find("scene", placed.id)).toBeNull();
  });
});
