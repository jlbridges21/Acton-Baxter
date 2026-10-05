export type ArrivalHotspot = {
  id: string;
  type: "link" | "info";
  /** Radians. */
  yaw: number;
  targetSceneId: string | null;
};

export type ArrivalHeading =
  | { kind: "opening"; yaw: number; pitch: number }
  | { kind: "return"; yaw: number; pitch: 0 }
  | { kind: "carry" };

/**
 * When several hotspots in the target scene point back at the source,
 * the lowest id wins. The same doorway then always sets the arrival heading.
 */
export function returnHotspotYaw(
  hotspots: ReadonlyArray<ArrivalHotspot>,
  sourceSceneId: string,
): number | null {
  const matches = hotspots
    .filter((hotspot) => hotspot.type === "link" && hotspot.targetSceneId === sourceSceneId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matches[0]?.yaw ?? null;
}

/** Radians, wrapped to (-π, π]. The hotspot at `yaw` ends up behind the visitor. */
export function yawFacingAway(yaw: number): number {
  return Math.atan2(Math.sin(yaw + Math.PI), Math.cos(yaw + Math.PI));
}

/**
 * Opening view wins. Otherwise a hotspot in the target that links back to the
 * source faces the visitor the other way, pitch level. With neither, the
 * caller keeps today's heading.
 */
export function arrivalHeading(input: {
  openingView: { yaw: number; pitch: number } | null;
  sourceSceneId: string | null;
  targetHotspots: ReadonlyArray<ArrivalHotspot>;
}): ArrivalHeading {
  if (input.openingView) {
    return {
      kind: "opening",
      yaw: input.openingView.yaw,
      pitch: input.openingView.pitch,
    };
  }
  if (input.sourceSceneId) {
    const yaw = returnHotspotYaw(input.targetHotspots, input.sourceSceneId);
    if (yaw != null) {
      return { kind: "return", yaw: yawFacingAway(yaw), pitch: 0 };
    }
  }
  return { kind: "carry" };
}

/** What an author sees when a link hotspot is selected. */
export function arrivalHeadingNote(input: {
  sourceSceneId: string;
  target: {
    name: string;
    hasInitialView: boolean;
    hotspots: ReadonlyArray<ArrivalHotspot>;
  } | null;
}): string | null {
  const target = input.target;
  if (!target) return null;
  const name = target.name;
  if (target.hasInitialView) {
    return `${name} uses its opening view on arrival. A return hotspot will not change that heading.`;
  }
  if (returnHotspotYaw(target.hotspots, input.sourceSceneId) != null) {
    return `${name} has a hotspot back to this scene. Visitors arrive facing away from it.`;
  }
  return `${name} has no hotspot back to this scene, so the heading is carried over.`;
}
