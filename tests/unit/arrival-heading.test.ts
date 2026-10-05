import { describe, expect, it } from "vitest";
import {
  arrivalHeading,
  arrivalHeadingNote,
  returnHotspotYaw,
  yawFacingAway,
  type ArrivalHotspot,
} from "@/lib/tours/arrival-heading";

function link(
  partial: Partial<ArrivalHotspot> & Pick<ArrivalHotspot, "id" | "yaw">,
): ArrivalHotspot {
  return {
    type: "link",
    targetSceneId: "scene-a",
    ...partial,
  };
}

describe("arrival heading", () => {
  it("faces away from the hotspot that links back, with a level pitch", () => {
    const heading = arrivalHeading({
      openingView: null,
      sourceSceneId: "scene-a",
      targetHotspots: [link({ id: "door", yaw: 0.4, targetSceneId: "scene-a" })],
    });
    expect(heading).toEqual({ kind: "return", yaw: yawFacingAway(0.4), pitch: 0 });
    expect(heading.kind === "return" && Math.cos(heading.yaw - (0.4 + Math.PI))).toBeCloseTo(1);
    expect(returnHotspotYaw([link({ id: "door", yaw: 1.2 })], "scene-a")).toBe(1.2);
  });

  it("keeps an explicit opening view, including its pitch", () => {
    const heading = arrivalHeading({
      openingView: { yaw: 0.2, pitch: -0.35 },
      sourceSceneId: "scene-a",
      targetHotspots: [link({ id: "door", yaw: 1 })],
    });
    expect(heading).toEqual({ kind: "opening", yaw: 0.2, pitch: -0.35 });
  });

  it("carries the heading when nothing points back", () => {
    expect(
      arrivalHeading({
        openingView: null,
        sourceSceneId: "scene-a",
        targetHotspots: [
          link({ id: "elsewhere", yaw: 0.5, targetSceneId: "scene-c" }),
          { id: "note", type: "info", yaw: 0.1, targetSceneId: "scene-a" },
        ],
      }),
    ).toEqual({ kind: "carry" });
    expect(
      arrivalHeading({
        openingView: null,
        sourceSceneId: null,
        targetHotspots: [link({ id: "door", yaw: 0.5 })],
      }),
    ).toEqual({ kind: "carry" });
  });

  it("picks the lowest hotspot id when several point back", () => {
    const hotspots = [
      link({ id: "m-late", yaw: 2, targetSceneId: "scene-a" }),
      link({ id: "a-early", yaw: -0.5, targetSceneId: "scene-a" }),
      link({ id: "b-mid", yaw: 1, targetSceneId: "scene-a" }),
    ];
    expect(returnHotspotYaw(hotspots, "scene-a")).toBe(-0.5);
    expect(
      arrivalHeading({
        openingView: null,
        sourceSceneId: "scene-a",
        targetHotspots: hotspots,
      }),
    ).toEqual({ kind: "return", yaw: yawFacingAway(-0.5), pitch: 0 });
  });

  it("tells the author which arrival rule will apply", () => {
    const back = [link({ id: "door", yaw: 0.2, targetSceneId: "scene-a" })];
    expect(
      arrivalHeadingNote({
        sourceSceneId: "scene-a",
        target: { name: "Kitchen", hasInitialView: false, hotspots: back },
      }),
    ).toMatch(/facing away/);
    expect(
      arrivalHeadingNote({
        sourceSceneId: "scene-a",
        target: { name: "Kitchen", hasInitialView: true, hotspots: back },
      }),
    ).toMatch(/opening view/);
    expect(
      arrivalHeadingNote({
        sourceSceneId: "scene-a",
        target: { name: "Kitchen", hasInitialView: false, hotspots: [] },
      }),
    ).toMatch(/carried over/);
    expect(
      arrivalHeadingNote({
        sourceSceneId: "scene-a",
        target: null,
      }),
    ).toBeNull();
  });
});
