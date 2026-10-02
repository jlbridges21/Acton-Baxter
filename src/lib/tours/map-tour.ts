import { tourImageUrl } from "@/lib/tours/image-url";
import { hotspotPlacement, hotspotShape } from "@/lib/tours/hotspot-shapes";
import {
  tourAutorotate,
  tourTransitionDirectional,
  tourTransitionEffect,
  tourTransitionSpeed,
} from "@/lib/tours/scene-transition";
import type { ViewerHotspot, ViewerScene, ViewerTour } from "@/lib/tours/viewer-model";

export type HotspotRow = {
  id: string;
  type: string;
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  target_scene_id: string | null;
  style_shape: string;
  style_color: string;
  style_size: number;
  style_rotation?: number | null;
  style_placement?: string | null;
};

export type SceneRow = {
  id: string;
  name: string;
  position: number;
  width: number | null;
  height: number | null;
  compat_path: string | null;
  thumbnail_path: string | null;
  initial_yaw: number;
  initial_pitch: number;
  has_initial_view: boolean;
  hotspots: HotspotRow[] | null;
};

export type TourRow = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  is_public: boolean;
  cover_scene_id: string | null;
  transition_effect?: string | null;
  transition_speed?: string | null;
  transition_directional?: boolean | null;
  autorotate?: boolean | null;
  scenes: SceneRow[] | null;
};

export const VIEWER_TOUR_SELECT = `
  id, title, description, slug, is_public, cover_scene_id,
  transition_effect, transition_speed, transition_directional, autorotate,
  scenes!scenes_tour_id_fkey (
    id, name, position, width, height, compat_path, thumbnail_path,
    initial_yaw, initial_pitch, has_initial_view,
    hotspots!hotspots_scene_id_fkey (
      id, type, yaw, pitch, label, content, target_scene_id, style_shape, style_color, style_size,
      style_rotation, style_placement
    )
  )
`;

/** Before migration 063. Style columns stay so a missing playback column does not drop them. */
export const VIEWER_TOUR_SELECT_BEFORE_PLAYBACK = VIEWER_TOUR_SELECT.replace(
  "\n  transition_effect, transition_speed, transition_directional, autorotate,",
  "",
);

/** Used only when 062 has not been applied yet. Rotation stays 0 and placement stays billboard. */
export const VIEWER_TOUR_SELECT_LEGACY = VIEWER_TOUR_SELECT_BEFORE_PLAYBACK.replace(
  ",\n      style_rotation, style_placement",
  "",
);

const MISSING_PLAYBACK_COLUMN =
  /transition_effect|transition_speed|transition_directional|autorotate/;

export async function readViewerTour(
  load: (select: string) => Promise<{ data: unknown; error: { message?: string } | null }>,
): Promise<ViewerTour | null> {
  let result = await load(VIEWER_TOUR_SELECT);
  let message = result.error?.message ?? "";
  if (result.error && MISSING_PLAYBACK_COLUMN.test(message)) {
    result = await load(VIEWER_TOUR_SELECT_BEFORE_PLAYBACK);
    message = result.error?.message ?? "";
  }
  if (result.error && /style_rotation|style_placement/.test(message)) {
    result = await load(VIEWER_TOUR_SELECT_LEGACY);
  }
  if (result.error || !result.data) return null;
  return mapViewerTour(result.data as TourRow);
}

export function mapViewerTour(row: TourRow): ViewerTour {
  const scenes = [...(row.scenes ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    slug: row.slug,
    isPublic: row.is_public,
    coverSceneId: row.cover_scene_id,
    transitionEffect: tourTransitionEffect(row.transition_effect),
    transitionSpeed: tourTransitionSpeed(row.transition_speed),
    transitionDirectional: tourTransitionDirectional(row.transition_directional),
    autorotate: tourAutorotate(row.autorotate),
    scenes: scenes.map((scene) => mapScene(row.slug, scene)),
  };
}

function mapScene(slug: string, scene: SceneRow): ViewerScene {
  const hotspots: ViewerHotspot[] = (scene.hotspots ?? []).flatMap((hotspot) => {
    if (hotspot.type !== "link" && hotspot.type !== "info") return [];
    return [
      {
        id: hotspot.id,
        type: hotspot.type,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        label: hotspot.label,
        content: hotspot.content,
        targetSceneId: hotspot.target_scene_id,
        styleShape: hotspotShape(hotspot.style_shape),
        styleColor: hotspot.style_color,
        styleSize: hotspot.style_size,
        styleRotation:
          typeof hotspot.style_rotation === "number" && Number.isFinite(hotspot.style_rotation)
            ? hotspot.style_rotation
            : 0,
        stylePlacement: hotspotPlacement(hotspot.style_placement ?? "billboard"),
      },
    ];
  });
  return {
    id: scene.id,
    name: scene.name,
    width: scene.width,
    height: scene.height,
    hasCompat: Boolean(scene.compat_path),
    hasInitialView: scene.has_initial_view,
    initialYaw: scene.initial_yaw,
    initialPitch: scene.initial_pitch,
    thumbUrl: scene.thumbnail_path ? tourImageUrl(slug, scene.id, "thumb") : null,
    hotspots,
  };
}

export function coverThumbUrl(tour: ViewerTour): string | null {
  if (!tour.coverSceneId) return null;
  const scene = tour.scenes.find((item) => item.id === tour.coverSceneId);
  return scene?.thumbUrl ?? null;
}
