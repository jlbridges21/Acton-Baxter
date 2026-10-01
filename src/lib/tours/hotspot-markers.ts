import type { ViewerHotspot } from "@/lib/tours/viewer-model";

export type HotspotMarkerSpec = {
  id: string;
  hotspotId: string;
  yaw: number;
  pitch: number;
  html: string;
  width: number;
  height: number;
  signature: string;
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

export function hotspotMarkerSpecs(input: {
  hotspots: ViewerHotspot[];
  sceneIds: ReadonlySet<string>;
  editMode: boolean;
  selectedId?: string | null;
}): HotspotMarkerSpec[] {
  const visible = input.editMode
    ? input.hotspots
    : input.hotspots.filter((hotspot) => hotspot.type === "info");
  const prefix = input.editMode ? "hotspot:" : "info:";
  return visible.map((hotspot) => {
    const id = `${prefix}${hotspot.id}`;
    const html = markerHtml(hotspot, {
      selected: input.selectedId === hotspot.id,
      broken: isBrokenLink(hotspot, input.sceneIds),
    });
    const width = hotspot.styleSize;
    const height = hotspot.styleSize;
    return {
      id,
      hotspotId: hotspot.id,
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
      html,
      width,
      height,
      signature: JSON.stringify({
        id,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        html,
        width,
        height,
      }),
    };
  });
}

/**
 * Adds, updates, or removes individual markers. Callers must not clear the set.
 */
export function planMarkerSync(input: {
  existing: Array<{ id: string; signature: string }>;
  desired: HotspotMarkerSpec[];
  managedPrefix: string;
}): MarkerSyncPlan {
  const desiredById = new Map(input.desired.map((marker) => [marker.id, marker]));
  const existingById = new Map(input.existing.map((marker) => [marker.id, marker.signature]));
  const remove = input.existing
    .filter((marker) => marker.id.startsWith(input.managedPrefix) && !desiredById.has(marker.id))
    .map((marker) => marker.id);
  const add: HotspotMarkerSpec[] = [];
  const update: HotspotMarkerSpec[] = [];
  for (const marker of input.desired) {
    const previous = existingById.get(marker.id);
    if (previous === undefined) add.push(marker);
    else if (previous !== marker.signature) update.push(marker);
  }
  return { add, update, remove };
}

function markerHtml(
  hotspot: ViewerHotspot,
  options: { selected: boolean; broken: boolean },
): string {
  const color = HEX.test(hotspot.styleColor) ? hotspot.styleColor : "#FFFFFF";
  const radius =
    hotspot.styleShape === "circle" ? "999px" : hotspot.styleShape === "arrow" ? "4px" : "0";
  const border = options.selected
    ? "3px solid #f5c518"
    : options.broken
      ? "2px dashed #b91c1c"
      : "2px solid #0b1f3a";
  const glyph = hotspot.type === "info" ? "i" : options.broken ? "!" : "→";
  return `<span data-hotspot-id="${hotspot.id}" style="display:grid;place-items:center;width:100%;height:100%;box-sizing:border-box;border-radius:${radius};background:${color};color:#0b1f3a;font-weight:700;border:${border}">${glyph}</span>`;
}
