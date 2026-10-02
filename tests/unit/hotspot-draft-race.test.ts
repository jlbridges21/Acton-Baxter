import { describe, expect, it } from "vitest";
import { HotspotDraftController, createHotspotWriteQueue } from "@/lib/tours/hotspot-draft";
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

function savedHotspot(saved: Record<string, string>, id: string): ViewerHotspot {
  const raw = saved[id];
  if (!raw) throw new Error(`Missing saved hotspot ${id}`);
  return JSON.parse(raw) as ViewerHotspot;
}

function controller(hotspots: ViewerHotspot[] = []) {
  const draft = new HotspotDraftController();
  const scenes = [{ id: "scene", hotspots }];
  draft.syncServer(scenes);
  return { draft, scenes };
}

describe("concurrent hotspot edits", () => {
  it("keeps a second placed hotspot when the first save resolves", () => {
    const { draft, scenes } = controller();
    const first = hotspot({ id: "a", yaw: 0.2, pitch: 0.1 });
    const second = hotspot({ id: "b", yaw: 1.4, pitch: -0.3 });
    const revisionA = draft.place("scene", first);
    const revisionB = draft.place("scene", second);
    const settled = draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionA,
      error: false,
      kind: "insert",
      sent: first,
    });
    expect(settled.resave).toBe(false);
    expect(draft.list("scene").map((item) => [item.id, item.yaw, item.pitch])).toEqual([
      ["a", 0.2, 0.1],
      ["b", 1.4, -0.3],
    ]);
    expect(draft.saved.b).toBeUndefined();
    expect(draft.isDirty(scenes)).toBe(true);
    draft.complete({
      sceneId: "scene",
      hotspotId: "b",
      revision: revisionB,
      error: false,
      kind: "insert",
      sent: second,
    });
    expect(draft.isDirty(scenes)).toBe(false);
    expect(savedHotspot(draft.saved, "b").yaw).toBe(1.4);
  });

  it("keeps a dragged hotspot when an earlier place resolves", () => {
    const existing = hotspot({ id: "b", yaw: 0.4, pitch: 0.2 });
    const { draft } = controller([existing]);
    const placed = hotspot({ id: "a", yaw: 0.1, pitch: 0 });
    const revisionA = draft.place("scene", placed);
    const dragged = { ...existing, yaw: 2.2, pitch: -0.55 };
    draft.patch("scene", dragged);
    draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionA,
      error: false,
      kind: "insert",
      sent: placed,
    });
    const survivor = draft.find("scene", "b");
    expect(survivor).toMatchObject({ yaw: 2.2, pitch: -0.55 });
    expect(draft.find("scene", "a")).toMatchObject({ yaw: 0.1, pitch: 0 });
  });

  it("keeps a later property edit when the earlier drag resolves", () => {
    const existing = hotspot({ id: "a", yaw: 0.3, pitch: 0.1, styleColor: "#FFFFFF" });
    const { draft } = controller([existing]);
    const dragged = { ...existing, yaw: 1.7, pitch: -0.25 };
    const revisionDrag = draft.patch("scene", dragged);
    const edited = { ...dragged, styleColor: "#112233", styleSize: 80 };
    const revisionEdit = draft.patch("scene", edited);
    const stale = draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionDrag,
      error: false,
      kind: "update",
      sent: dragged,
    });
    expect(stale.resave).toBe(true);
    expect(draft.find("scene", "a")).toMatchObject({
      yaw: 1.7,
      pitch: -0.25,
      styleColor: "#112233",
      styleSize: 80,
    });
    expect(savedHotspot(draft.saved, "a").styleColor).toBe("#FFFFFF");
    draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionEdit,
      error: false,
      kind: "update",
      sent: edited,
    });
    expect(savedHotspot(draft.saved, "a")).toMatchObject({
      yaw: 1.7,
      pitch: -0.25,
      styleColor: "#112233",
    });
  });

  it("removes only the failed insert", () => {
    const { draft } = controller();
    const first = hotspot({ id: "a", yaw: 0.2, pitch: 0.1 });
    const second = hotspot({ id: "b", yaw: 0.8, pitch: 0.4 });
    const revisionA = draft.place("scene", first);
    draft.place("scene", second);
    draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionA,
      error: true,
      kind: "insert",
      sent: first,
    });
    expect(draft.list("scene").map((item) => item.id)).toEqual(["b"]);
    expect(draft.find("scene", "b")).toMatchObject({ yaw: 0.8, pitch: 0.4 });
  });

  it("does not roll back a newer edit when the earlier save fails", () => {
    const existing = hotspot({ id: "a", yaw: 0.2, pitch: 0 });
    const { draft } = controller([existing]);
    const dragged = { ...existing, yaw: 1.1, pitch: 0.3 };
    const revisionDrag = draft.patch("scene", dragged);
    draft.patch("scene", { ...dragged, styleShape: "circle", styleSize: 64 });
    draft.complete({
      sceneId: "scene",
      hotspotId: "a",
      revision: revisionDrag,
      error: true,
      kind: "update",
      sent: dragged,
    });
    expect(draft.find("scene", "a")).toMatchObject({
      yaw: 1.1,
      pitch: 0.3,
      styleShape: "circle",
      styleSize: 64,
    });
  });
});

describe("hotspot write queue", () => {
  it("overlaps different hotspots and orders writes to the same one", async () => {
    const queue = createHotspotWriteQueue();
    let releaseFirst: () => void = () => undefined;
    const firstBlock = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let otherStarted = false;
    let sameStarted = false;
    const first = queue.enqueue("a", async () => {
      await firstBlock;
    });
    const other = queue.enqueue("b", async () => {
      otherStarted = true;
    });
    await other;
    expect(otherStarted).toBe(true);
    const same = queue.enqueue("a", async () => {
      sameStarted = true;
    });
    await Promise.resolve();
    expect(sameStarted).toBe(false);
    releaseFirst();
    await first;
    await same;
    expect(sameStarted).toBe(true);
  });
});
