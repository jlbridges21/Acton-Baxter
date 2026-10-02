import type { ViewerHotspot } from "@/lib/tours/viewer-model";
import {
  hotspotShapeSvg,
  shapeUsesRotation,
  type HotspotPlacement,
} from "@/lib/tours/hotspot-shapes";

export type HotspotMarkerSpec = {
  id: string;
  hotspotId: string;
  yaw: number;
  pitch: number;
  html: string;
  width: number;
  height: number;
  signature: string;
  placement: HotspotPlacement;
  /** Degrees. Meaningful for arrows and chevrons; stored for every shape. */
  rotation: number;
  targetSceneId: string | null;
  markerKind: "info" | "link";
  /** Target scene name for a link. Info hotspots keep their own popover. */
  tooltip: string | null;
};

export type MarkerSyncPlan = {
  add: HotspotMarkerSpec[];
  update: HotspotMarkerSpec[];
  remove: string[];
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isBrokenLink(hotspot: ViewerHotspot, sceneIds: ReadonlySet<string>): boolean {
  return (
    hotspot.type === "link" && (!hotspot.targetSceneId || !sceneIds.has(hotspot.targetSceneId))
  );
}

export type HotspotListRow = {
  /** What the hotspot points at. The full string, even when the row truncates it. */
  primary: string;
  muted: boolean;
  /** Same condition as the dashed red marker: no target, or a target that is gone. */
  broken: boolean;
  kind: "Link" | "Info";
};

/**
 * Left side of an editor hotspot row. A null target covers both "not chosen yet"
 * and a scene deleted after migration 061 (ON DELETE SET NULL). A target id that
 * is no longer in the tour uses the broken-link wording.
 */
export function hotspotListRow(
  hotspot: ViewerHotspot,
  scenes: ReadonlyArray<{ id: string; name: string }>,
): HotspotListRow {
  if (hotspot.type === "info") {
    const label = hotspot.label?.trim() ?? "";
    return {
      primary: label || "Untitled",
      muted: !label,
      broken: false,
      kind: "Info",
    };
  }
  const target = hotspot.targetSceneId
    ? scenes.find((scene) => scene.id === hotspot.targetSceneId)
    : undefined;
  if (target) {
    return { primary: target.name, muted: false, broken: false, kind: "Link" };
  }
  if (hotspot.targetSceneId) {
    return { primary: "Broken link", muted: false, broken: true, kind: "Link" };
  }
  return { primary: "No target scene", muted: true, broken: true, kind: "Link" };
}

export function hotspotMarkerSpecs(input: {
  hotspots: ViewerHotspot[];
  sceneIds: ReadonlySet<string>;
  editMode: boolean;
  selectedId?: string | null;
  sceneNames?: ReadonlyMap<string, string>;
}): HotspotMarkerSpec[] {
  const visible = input.editMode
    ? input.hotspots
    : input.hotspots.filter((hotspot) => visibleInPlayback(hotspot, input.sceneIds));
  const prefix = input.editMode ? "hotspot:" : "info:";
  return visible.map((hotspot) => {
    const id = `${prefix}${hotspot.id}`;
    const html = markerHtml(hotspot, {
      selected: input.selectedId === hotspot.id,
      broken: isBrokenLink(hotspot, input.sceneIds),
    });
    const width = hotspot.styleSize;
    const height = hotspot.styleSize;
    const placement = hotspot.stylePlacement;
    const rotation = shapeUsesRotation(hotspot.styleShape) ? hotspot.styleRotation : 0;
    const tooltip =
      hotspot.type === "link" && hotspot.targetSceneId
        ? (input.sceneNames?.get(hotspot.targetSceneId) ?? null)
        : null;
    return {
      id,
      hotspotId: hotspot.id,
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
      html,
      width,
      height,
      placement,
      rotation,
      targetSceneId: hotspot.type === "link" ? hotspot.targetSceneId : null,
      markerKind: hotspot.type === "info" ? "info" : "link",
      tooltip,
      signature: JSON.stringify({
        id,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        html,
        width,
        height,
        placement,
        rotation,
        tooltip,
      }),
    };
  });
}

function visibleInPlayback(hotspot: ViewerHotspot, sceneIds: ReadonlySet<string>): boolean {
  if (hotspot.type === "info") return true;
  if (hotspot.stylePlacement !== "floor") return false;
  return Boolean(hotspot.targetSceneId && sceneIds.has(hotspot.targetSceneId));
}

/**
 * Adds, updates, or removes individual markers. A placement change removes and
 * re-adds that one marker because Photo Sphere Viewer cannot change marker type.
 * Callers must not clear the set.
 */
export function planMarkerSync(input: {
  existing: Array<{ id: string; signature: string; placement?: HotspotPlacement }>;
  desired: HotspotMarkerSpec[];
  managedPrefix: string;
}): MarkerSyncPlan {
  const desiredById = new Map(input.desired.map((marker) => [marker.id, marker]));
  const existingById = new Map(input.existing.map((marker) => [marker.id, marker]));
  const remove = input.existing
    .filter((marker) => marker.id.startsWith(input.managedPrefix) && !desiredById.has(marker.id))
    .map((marker) => marker.id);
  const add: HotspotMarkerSpec[] = [];
  const update: HotspotMarkerSpec[] = [];
  for (const marker of input.desired) {
    const previous = existingById.get(marker.id);
    if (!previous) {
      add.push(marker);
      continue;
    }
    const placementChanged = (previous.placement ?? "billboard") !== marker.placement;
    if (placementChanged) {
      remove.push(marker.id);
      add.push(marker);
    } else if (previous.signature !== marker.signature) {
      update.push(marker);
    }
  }
  return { add, update, remove };
}

function markerHtml(
  hotspot: ViewerHotspot,
  options: { selected: boolean; broken: boolean },
): string {
  const color = HEX.test(hotspot.styleColor) ? hotspot.styleColor : "#FFFFFF";
  const border = options.selected
    ? "3px solid #f5c518"
    : options.broken
      ? "2px dashed #b91c1c"
      : "2px solid #0b1f3a";
  const svg = hotspotShapeSvg(hotspot.styleShape, color);
  return `<span data-hotspot-id="${hotspot.id}" style="display:grid;place-items:center;width:100%;height:100%;box-sizing:border-box;border-radius:4px;background:rgba(11,31,58,0.35);border:${border}">${svg}</span>`;
}
