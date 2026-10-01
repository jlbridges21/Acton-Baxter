import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HotspotDragSession, dragExceededThreshold } from "@/lib/tours/hotspot-drag";
import { isBrokenLink, planMarkerSync, hotspotMarkerSpecs } from "@/lib/tours/hotspot-markers";
import { placeInfoPopover } from "@/lib/tours/info-popover";
import type { ViewerHotspot } from "@/lib/tours/viewer-model";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function hotspot(partial: Partial<ViewerHotspot> & Pick<ViewerHotspot, "id">): ViewerHotspot {
  return {
    type: "link",
    yaw: 0.4,
    pitch: -0.2,
    label: null,
    content: null,
    targetSceneId: "other",
    styleShape: "arrow",
    styleColor: "#FFFFFF",
    styleSize: 48,
    ...partial,
  };
}

describe("hotspot edit mode", () => {
  it("renders every hotspot as a marker and leaves playback links off dangling targets", () => {
    const specs = hotspotMarkerSpecs({
      editMode: true,
      sceneIds: new Set(["here", "other"]),
      selectedId: "link",
      hotspots: [
        hotspot({ id: "link" }),
        hotspot({ id: "info", type: "info", targetSceneId: null, styleShape: "circle" }),
        hotspot({ id: "broken", targetSceneId: null }),
      ],
    });
    expect(specs.map((marker) => marker.id)).toEqual([
      "hotspot:link",
      "hotspot:info",
      "hotspot:broken",
    ]);
    expect(specs.every((marker) => !("content" in marker))).toBe(true);
    expect(specs[2]?.html).toMatch(/dashed #b91c1c/);
    const playback = hotspotMarkerSpecs({
      editMode: false,
      sceneIds: new Set(["here"]),
      hotspots: [hotspot({ id: "link" }), hotspot({ id: "info", type: "info" })],
    });
    expect(playback.map((marker) => marker.id)).toEqual(["info:info"]);
    expect(isBrokenLink(hotspot({ id: "broken", targetSceneId: "gone" }), new Set(["here"]))).toBe(
      true,
    );
  });

  it("updates one marker at a time", () => {
    const desired = hotspotMarkerSpecs({
      editMode: true,
      sceneIds: new Set(["other"]),
      hotspots: [hotspot({ id: "a" }), hotspot({ id: "b", yaw: 1 })],
    });
    const first = desired[0];
    const second = desired[1];
    if (!first || !second) throw new Error("expected two markers");
    const plan = planMarkerSync({
      managedPrefix: "hotspot:",
      existing: [
        { id: first.id, signature: first.signature },
        { id: "hotspot:old", signature: "stale" },
      ],
      desired,
    });
    expect(plan.remove).toEqual(["hotspot:old"]);
    expect(plan.add.map((marker) => marker.id)).toEqual([second.id]);
    expect(plan.update).toEqual([]);
    const moved = { ...second, yaw: 2, signature: "moved" };
    const next = planMarkerSync({
      managedPrefix: "hotspot:",
      existing: desired.map((marker) => ({ id: marker.id, signature: marker.signature })),
      desired: [first, moved],
    });
    expect(next.remove).toEqual([]);
    expect(next.add).toEqual([]);
    expect(next.update).toEqual([moved]);
  });
});

describe("hotspot drag", () => {
  it("treats a 4px press as a click and writes once after a real drag", () => {
    expect(dragExceededThreshold(4, 0)).toBe(false);
    expect(dragExceededThreshold(5, 0)).toBe(true);
    const host = fakeHost();
    const session = new HotspotDragSession(host);
    session.pointerDown("spot", { pointerId: 1, clientX: 10, clientY: 10 });
    session.pointerMove({ pointerId: 1, clientX: 14, clientY: 10 });
    session.pointerUp({ pointerId: 1, clientX: 14, clientY: 10 });
    expect(host.mousemove).toEqual([]);
    expect(host.captures).toEqual([]);
    expect(host.updates).toEqual([]);
    expect(host.commits).toEqual([]);
    expect(session.commits).toBe(0);

    session.pointerDown("spot", { pointerId: 1, clientX: 0, clientY: 0 });
    session.pointerMove({ pointerId: 1, clientX: 3, clientY: 4 });
    session.pointerMove({ pointerId: 1, clientX: 8, clientY: 0 });
    session.pointerMove({ pointerId: 1, clientX: 12, clientY: 1 });
    session.pointerUp({ pointerId: 1, clientX: 12, clientY: 1 });
    expect(host.mousemove).toEqual([false, true]);
    expect(host.captures).toEqual([1]);
    expect(host.updates.length).toBe(3);
    expect(host.commits).toEqual([{ id: "spot", yaw: 12, pitch: 1 }]);
    expect(session.commits).toBe(1);
  });

  it("restores panorama panning when a drag is cancelled", () => {
    const host = fakeHost();
    const session = new HotspotDragSession(host);
    session.pointerDown("spot", { pointerId: 4, clientX: 0, clientY: 0 });
    session.pointerMove({ pointerId: 4, clientX: 20, clientY: 0 });
    session.cancel();
    expect(host.mousemove).toEqual([false, true]);
    expect(host.releases).toEqual([4]);
    expect(host.commits).toEqual([]);
  });
});

describe("info popover placement", () => {
  it("clamps inside the viewer and hides a point behind the camera", () => {
    expect(
      placeInfoPopover({
        visible: false,
        point: { x: 100, y: 100 },
        viewerWidth: 800,
        viewerHeight: 400,
        boxWidth: 240,
        boxHeight: 120,
      }),
    ).toBeNull();
    expect(
      placeInfoPopover({
        visible: true,
        point: { x: 4, y: 4 },
        viewerWidth: 800,
        viewerHeight: 400,
        boxWidth: 240,
        boxHeight: 120,
      }),
    ).toEqual({ x: 8, y: 8 });
    expect(
      placeInfoPopover({
        visible: true,
        point: { x: 900, y: 500 },
        viewerWidth: 800,
        viewerHeight: 400,
        boxWidth: 240,
        boxHeight: 120,
      }),
    ).toEqual({ x: 552, y: 272 });
  });
});

describe("hotspot persistence", () => {
  it("updates named columns, stores radians unchanged, and never upserts", () => {
    const actions = source("src/lib/tours/actions.ts");
    const store = source("src/lib/tours/store.ts");
    const viewer = source("src/components/tours/panorama-viewer.tsx");
    expect(store).toMatch(/initial_yaw: yaw/);
    expect(store).toMatch(/has_initial_view: true/);
    expect(store).toMatch(/has_initial_view: false/);
    expect(`${actions}\n${store}`).not.toMatch(/\.upsert\(/);
    expect(actions).toMatch(/yaw: fields\.data\.yaw/);
    expect(actions).toMatch(/pitch: fields\.data\.pitch/);
    expect(actions).not.toMatch(/Math\.PI/);
    expect(viewer).toMatch(/includeLinks: !editModeRef\.current/);
    expect(viewer).toMatch(/viewerCoordsToSphericalCoords/);
    expect(viewer).toMatch(/setOption\("mousemove", enabled\)/);
    expect(viewer).toMatch(/setPointerCapture\(pointerId\)/);
    expect(viewer).toMatch(/markers\.updateMarker\(/);
    expect(viewer).toMatch(/markers\.addMarker\(/);
    expect(viewer).toMatch(/markers\.removeMarker\(/);
    expect(viewer).not.toMatch(/setMarkers\(/);
    expect(viewer).not.toMatch(/\bcontent:/);
    expect(source("src/components/tours/info-popover.tsx")).not.toMatch(/marker\.content/);
    expect(source("supabase/migrations/061_hotspot_target_set_null.sql")).toMatch(
      /on delete set null/i,
    );
  });
});

function fakeHost() {
  const host = {
    mousemove: [] as boolean[],
    captures: [] as number[],
    releases: [] as number[],
    updates: [] as Array<{ id: string; yaw: number; pitch: number }>,
    commits: [] as Array<{ id: string; yaw: number; pitch: number }>,
    setMousemove(enabled: boolean) {
      host.mousemove.push(enabled);
    },
    capture(pointerId: number) {
      host.captures.push(pointerId);
    },
    releaseCapture(pointerId: number) {
      host.releases.push(pointerId);
    },
    viewerPoint(event: { clientX: number; clientY: number }) {
      return { x: event.clientX, y: event.clientY };
    },
    toSpherical(point: { x: number; y: number }) {
      return { yaw: point.x, pitch: point.y };
    },
    updateMarker(id: string, yaw: number, pitch: number) {
      host.updates.push({ id, yaw, pitch });
    },
    commit(id: string, yaw: number, pitch: number) {
      host.commits.push({ id, yaw, pitch });
    },
  };
  return host;
}
