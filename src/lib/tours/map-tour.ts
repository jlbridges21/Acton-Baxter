import { tourImageUrl } from "@/lib/tours/image-url";
import type { ViewerHotspot, ViewerScene, ViewerTour } from "@/lib/tours/viewer-model";

export type HotspotRow = {
  id: string;
  type: string;
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  target_scene_id: string | null;
  style_color: string;
  style_size: number;
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
  scenes: SceneRow[] | null;
};

export const VIEWER_TOUR_SELECT = `
  id, title, description, slug, is_public, cover_scene_id,
  scenes!scenes_tour_id_fkey (
    id, name, position, width, height, compat_path, thumbnail_path,
    initial_yaw, initial_pitch, has_initial_view,
    hotspots (
      id, type, yaw, pitch, label, content, target_scene_id, style_color, style_size
    )
  )
`;

export function mapViewerTour(row: TourRow): ViewerTour {
  const scenes = [...(row.scenes ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    slug: row.slug,
    isPublic: row.is_public,
    coverSceneId: row.cover_scene_id,
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
        styleColor: hotspot.style_color,
        styleSize: hotspot.style_size,
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
