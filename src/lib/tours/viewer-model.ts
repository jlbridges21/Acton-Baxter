import { tourImageUrl } from "@/lib/tours/image-url";
import type { HotspotPlacement, HotspotShape } from "@/lib/tours/hotspot-shapes";

export type ViewerHotspot = {
  id: string;
  type: "link" | "info";
  /** Radians. Photo Sphere Viewer and the database both use radians. */
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  targetSceneId: string | null;
  styleShape: HotspotShape;
  styleColor: string;
  styleSize: number;
  /** Degrees, 0–359. */
  styleRotation: number;
  stylePlacement: HotspotPlacement;
};

export type ViewerScene = {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  hasCompat: boolean;
  hasInitialView: boolean;
  initialYaw: number;
  initialPitch: number;
  thumbUrl: string | null;
  hotspots: ViewerHotspot[];
};

export type ViewerTour = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  isPublic: boolean;
  coverSceneId: string | null;
  scenes: ViewerScene[];
};

export type TourNodeSpec = {
  id: string;
  name: string;
  panorama: string;
  links: Array<{
    nodeId: string;
    position: { yaw: number; pitch: number };
    arrowStyle: { size: { width: number; height: number } };
    data: { color: string; size: number };
  }>;
};

/** Compat only when the original is wider than this GPU and a fallback file exists. */
export function resolvePanoramaVariant(
  width: number | null,
  hasCompat: boolean,
  maxTextureSize: number,
): "full" | "compat" {
  if (width != null && width > maxTextureSize && hasCompat) return "compat";
  return "full";
}

/**
 * A click is a direction on the sphere. The panorama's pixel size is not part
 * of the stored yaw and pitch, so the reduced editor image and the full
 * published image place the same hotspot.
 */
export function placedHotspotAngles(
  click: { yaw: number; pitch: number },
  panorama: { width: number; height: number },
): { yaw: number; pitch: number } {
  if (!Number.isFinite(panorama.width) || !Number.isFinite(panorama.height)) {
    throw new Error("Panorama dimensions must be finite.");
  }
  return { yaw: click.yaw, pitch: click.pitch };
}

/**
 * Panorama URLs are final here. Call this before setNodes and do not rewrite them after.
 * Link positions stay in radians.
 */
export function buildVirtualTourNodes(input: {
  slug: string;
  scenes: ViewerScene[];
  maxTextureSize: number;
  /** Edit mode passes false so a click selects a hotspot instead of changing scenes. */
  includeLinks?: boolean;
  /**
   * `edit` always requests the reduced editor image. Published and preview
   * pages omit this and keep the adaptive full-vs-compat choice.
   */
  resolution?: "adaptive" | "edit";
}): TourNodeSpec[] {
  const ids = new Set(input.scenes.map((scene) => scene.id));
  const includeLinks = input.includeLinks !== false;
  return input.scenes.map((scene) => {
    const variant =
      input.resolution === "edit"
        ? "edit"
        : resolvePanoramaVariant(scene.width, scene.hasCompat, input.maxTextureSize);
    return {
      id: scene.id,
      name: scene.name,
      panorama: tourImageUrl(input.slug, scene.id, variant),
      links: includeLinks ? playbackLinks(scene, ids) : [],
    };
  });
}

function playbackLinks(scene: ViewerScene, ids: Set<string>): TourNodeSpec["links"] {
  return scene.hotspots.flatMap((hotspot) => {
    if (hotspot.type !== "link" || !hotspot.targetSceneId) return [];
    if (hotspot.stylePlacement === "floor") return [];
    if (!ids.has(hotspot.targetSceneId)) return [];
    return [
      {
        nodeId: hotspot.targetSceneId,
        position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
        arrowStyle: { size: { width: hotspot.styleSize, height: hotspot.styleSize } },
        data: { color: hotspot.styleColor, size: hotspot.styleSize },
      },
    ];
  });
}

export function viewerNodesKey(nodes: TourNodeSpec[]): string {
  return JSON.stringify(nodes);
}
