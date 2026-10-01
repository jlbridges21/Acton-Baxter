import "server-only";

import { createClient } from "@/lib/supabase/server";
import { tourImageUrl } from "@/lib/tours/image-url";
import { readViewerTour } from "@/lib/tours/map-tour";
import { insertWithUniqueSlug } from "@/lib/tours/slug";
import type { TourDetail, TourScene, TourSummary } from "@/lib/tours/types";
import type { ViewerTour } from "@/lib/tours/viewer-model";

type DbError = { message?: string } | null;

function message(error: DbError, fallback: string): string {
  return error?.message || fallback;
}

async function db() {
  return createClient();
}

type TourRow = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  is_public: boolean;
  project_number: string | null;
  created_at: string;
  owner_id: string;
  cover_scene_id: string | null;
  owner: { full_name: string | null } | { full_name: string | null }[] | null;
  scenes: { count: number }[] | null;
  cover:
    | { id: string; thumbnail_path: string | null }
    | { id: string; thumbnail_path: string | null }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listTours(): Promise<{ tours: TourSummary[]; error: string | null }> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("tours")
    .select(
      `
      id, title, description, slug, is_public, project_number, created_at, owner_id, cover_scene_id,
      owner:profiles!tours_owner_id_fkey(full_name),
      scenes!scenes_tour_id_fkey(count),
      cover:scenes!fk_cover_scene(id, thumbnail_path)
    `,
    )
    .order("created_at", { ascending: false });
  if (error) return { tours: [], error: message(error, "Could not load tours.") };

  const rows = (data ?? []) as TourRow[];

  return {
    error: null,
    tours: rows.map((row) => {
      const cover = one(row.cover);
      const owner = one(row.owner);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        slug: row.slug,
        isPublic: row.is_public,
        projectNumber: row.project_number,
        createdAt: row.created_at,
        ownerId: row.owner_id,
        ownerName: owner?.full_name?.trim() || "Unknown",
        sceneCount: row.scenes?.[0]?.count ?? 0,
        coverUrl: cover?.thumbnail_path ? tourImageUrl(row.slug, cover.id, "thumb") : null,
      };
    }),
  };
}

export async function getTour(
  tourId: string,
): Promise<{ tour: TourDetail | null; error: string | null }> {
  const supabase = await db();
  const { data: tour, error } = await supabase
    .from("tours")
    .select("id, title, description, slug, is_public")
    .eq("id", tourId)
    .maybeSingle();
  if (error) return { tour: null, error: message(error, "Could not load this tour.") };
  if (!tour) return { tour: null, error: "That tour was not found." };

  const { data: scenes, error: sceneError } = await supabase
    .from("scenes")
    .select("id, tour_id, name, position, width, height, thumbnail_path")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });
  if (sceneError) return { tour: null, error: message(sceneError, "Could not load scenes.") };

  const slug = tour.slug as string;
  const mapped: TourScene[] = (scenes ?? []).map((scene) => ({
    id: scene.id as string,
    tourId: scene.tour_id as string,
    name: scene.name as string,
    position: scene.position as number,
    width: (scene.width as number | null) ?? null,
    height: (scene.height as number | null) ?? null,
    thumbnailUrl: scene.thumbnail_path ? tourImageUrl(slug, scene.id as string, "thumb") : null,
  }));

  return {
    error: null,
    tour: {
      id: tour.id as string,
      title: tour.title as string,
      description: (tour.description as string | null) ?? null,
      slug,
      isPublic: tour.is_public as boolean,
      scenes: mapped,
    },
  };
}

export async function insertTour(
  ownerId: string,
): Promise<{ tourId: string | null; error: string | null }> {
  const supabase = await db();
  const created = await insertWithUniqueSlug(async (slug) => {
    const { data, error } = await supabase
      .from("tours")
      .insert({
        owner_id: ownerId,
        title: "Untitled Tour",
        slug,
        is_public: false,
      })
      .select("id")
      .single();
    if (!error && data?.id) return { ok: true as const, value: data.id as string };
    return {
      ok: false as const,
      code: error?.code ?? null,
      message: message(error, "Could not create the tour."),
    };
  });
  return { tourId: created.value, error: created.error };
}

export async function getViewerTour(tourId: string): Promise<ViewerTour | null> {
  const supabase = await db();
  return readViewerTour(async (select) => {
    const { data, error } = await supabase
      .from("tours")
      .select(select)
      .eq("id", tourId)
      .maybeSingle();
    return { data, error };
  });
}

export async function getTourSlug(tourId: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase.from("tours").select("slug").eq("id", tourId).maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}

export async function tourExists(tourId: string): Promise<boolean> {
  const supabase = await db();
  const { data, error } = await supabase.from("tours").select("id").eq("id", tourId).maybeSingle();
  return !error && Boolean(data?.id);
}

export async function updateTourTitle(
  tourId: string,
  title: string,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase.from("tours").update({ title }).eq("id", tourId);
  return { error: error ? message(error, "Could not rename the tour.") : null };
}

export async function updateTourVisibility(
  tourId: string,
  isPublic: boolean,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase.from("tours").update({ is_public: isPublic }).eq("id", tourId);
  return { error: error ? message(error, "Could not update visibility.") : null };
}

type ScenePathRow = {
  id: string;
  storage_path: string;
  compat_path: string | null;
  thumbnail_path: string | null;
};

export async function listScenePaths(tourId: string): Promise<ScenePathRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("scenes")
    .select("id, storage_path, compat_path, thumbnail_path")
    .eq("tour_id", tourId);
  if (error) throw new Error(message(error, "Could not list panorama files."));
  return (data ?? []) as ScenePathRow[];
}

export async function getScenePath(tourId: string, sceneId: string): Promise<ScenePathRow | null> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("scenes")
    .select("id, storage_path, compat_path, thumbnail_path")
    .eq("id", sceneId)
    .eq("tour_id", tourId)
    .maybeSingle();
  if (error) throw new Error(message(error, "Could not load that scene."));
  return (data as ScenePathRow | null) ?? null;
}

export async function deleteTourRow(tourId: string): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase.from("tours").delete().eq("id", tourId);
  return { error: error ? message(error, "Could not delete the tour.") : null };
}

export async function deleteSceneRow(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase.from("scenes").delete().eq("id", sceneId).eq("tour_id", tourId);
  if (error) return { error: message(error, "Could not delete the scene.") };
  await fillCoverIfEmpty(tourId);
  return { error: null };
}

async function fillCoverIfEmpty(tourId: string): Promise<void> {
  const supabase = await db();
  const { data: tour } = await supabase
    .from("tours")
    .select("cover_scene_id")
    .eq("id", tourId)
    .maybeSingle();
  if (!tour || tour.cover_scene_id) return;
  const { data: next } = await supabase
    .from("scenes")
    .select("id")
    .eq("tour_id", tourId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next?.id) return;
  await supabase.from("tours").update({ cover_scene_id: next.id }).eq("id", tourId);
}

export async function insertScene(input: {
  id: string;
  tourId: string;
  name: string;
  storagePath: string;
  compatPath: string | null;
  thumbnailPath: string;
  width: number;
  height: number;
}): Promise<{ error: string | null }> {
  const supabase = await db();
  const { data: last } = await supabase
    .from("scenes")
    .select("position")
    .eq("tour_id", input.tourId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = typeof last?.position === "number" ? last.position + 1 : 0;
  const { error } = await supabase.from("scenes").insert({
    id: input.id,
    tour_id: input.tourId,
    name: input.name,
    storage_path: input.storagePath,
    compat_path: input.compatPath,
    thumbnail_path: input.thumbnailPath,
    width: input.width,
    height: input.height,
    position,
    initial_yaw: 0,
    initial_pitch: 0,
    has_initial_view: false,
  });
  if (error) return { error: message(error, "Could not save the scene.") };
  await fillCoverIfEmpty(input.tourId);
  return { error: null };
}

export async function updateSceneName(
  tourId: string,
  sceneId: string,
  name: string,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase
    .from("scenes")
    .update({ name })
    .eq("id", sceneId)
    .eq("tour_id", tourId);
  return { error: error ? message(error, "Could not rename the scene.") : null };
}

export async function setCoverScene(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const scene = await getScenePath(tourId, sceneId);
  if (!scene) return { error: "That scene was not found." };
  const supabase = await db();
  const { error } = await supabase
    .from("tours")
    .update({ cover_scene_id: sceneId })
    .eq("id", tourId);
  return { error: error ? message(error, "Could not set the cover scene.") : null };
}

export async function setScenePositions(
  tourId: string,
  sceneIds: string[],
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { data, error } = await supabase.from("scenes").select("id").eq("tour_id", tourId);
  if (error) return { error: message(error, "Could not reorder scenes.") };
  const existing = new Set((data ?? []).map((row) => row.id as string));
  if (sceneIds.length !== existing.size || sceneIds.some((id) => !existing.has(id))) {
    return { error: "Could not reorder scenes." };
  }
  for (let index = 0; index < sceneIds.length; index += 1) {
    const id = sceneIds[index];
    if (!id) continue;
    const { error: updateError } = await supabase
      .from("scenes")
      .update({ position: index })
      .eq("id", id)
      .eq("tour_id", tourId);
    if (updateError) return { error: message(updateError, "Could not reorder scenes.") };
  }
  return { error: null };
}

export async function insertHotspot(input: {
  id: string;
  tourId: string;
  sceneId: string;
  targetSceneId: string | null;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  styleShape: "arrow" | "chevron" | "circle" | "ring" | "dot" | "pulse";
  styleColor: string;
  styleSize: number;
  styleRotation: number;
  stylePlacement: "billboard" | "floor";
}): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase.from("hotspots").insert({
    id: input.id,
    scene_id: input.sceneId,
    target_scene_id: input.targetSceneId,
    type: input.type,
    yaw: input.yaw,
    pitch: input.pitch,
    label: input.label,
    content: input.content,
    style_shape: input.styleShape,
    style_color: input.styleColor,
    style_size: input.styleSize,
    style_rotation: input.styleRotation,
    style_placement: input.stylePlacement,
  });
  return { error: error ? message(error, "Could not create the hotspot.") : null };
}

export async function updateHotspot(input: {
  id: string;
  sceneId: string;
  targetSceneId: string | null;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  styleShape: "arrow" | "chevron" | "circle" | "ring" | "dot" | "pulse";
  styleColor: string;
  styleSize: number;
  styleRotation: number;
  stylePlacement: "billboard" | "floor";
}): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase
    .from("hotspots")
    .update({
      type: input.type,
      yaw: input.yaw,
      pitch: input.pitch,
      label: input.label,
      content: input.content,
      target_scene_id: input.targetSceneId,
      style_shape: input.styleShape,
      style_color: input.styleColor,
      style_size: input.styleSize,
      style_rotation: input.styleRotation,
      style_placement: input.stylePlacement,
    })
    .eq("id", input.id)
    .eq("scene_id", input.sceneId);
  return { error: error ? message(error, "Could not update the hotspot.") : null };
}

export async function deleteHotspotRow(
  sceneId: string,
  hotspotId: string,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase
    .from("hotspots")
    .delete()
    .eq("id", hotspotId)
    .eq("scene_id", sceneId);
  return { error: error ? message(error, "Could not delete the hotspot.") : null };
}

export async function hotspotBelongsToScene(sceneId: string, hotspotId: string): Promise<boolean> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("hotspots")
    .select("id")
    .eq("id", hotspotId)
    .eq("scene_id", sceneId)
    .maybeSingle();
  if (error) throw new Error(message(error, "Could not load that hotspot."));
  return Boolean(data?.id);
}

export async function setSceneOpeningView(
  tourId: string,
  sceneId: string,
  yaw: number,
  pitch: number,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase
    .from("scenes")
    .update({
      initial_yaw: yaw,
      initial_pitch: pitch,
      has_initial_view: true,
    })
    .eq("id", sceneId)
    .eq("tour_id", tourId);
  return { error: error ? message(error, "Could not save the opening view.") : null };
}

export async function clearSceneOpeningView(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { error } = await supabase
    .from("scenes")
    .update({
      initial_yaw: 0,
      initial_pitch: 0,
      has_initial_view: false,
    })
    .eq("id", sceneId)
    .eq("tour_id", tourId);
  return { error: error ? message(error, "Could not clear the opening view.") : null };
}

export async function swapScenePosition(
  tourId: string,
  sceneId: string,
  direction: "up" | "down",
): Promise<{ error: string | null }> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("scenes")
    .select("id, position")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });
  if (error) return { error: message(error, "Could not reorder scenes.") };
  const rows = data ?? [];
  const index = rows.findIndex((row) => row.id === sceneId);
  const neighbor = index + (direction === "up" ? -1 : 1);
  const current = rows[index];
  const other = rows[neighbor];
  if (!current || !other) return { error: null };
  const { error: firstError } = await supabase
    .from("scenes")
    .update({ position: other.position })
    .eq("id", current.id)
    .eq("tour_id", tourId);
  if (firstError) return { error: message(firstError, "Could not reorder scenes.") };
  const { error: secondError } = await supabase
    .from("scenes")
    .update({ position: current.position })
    .eq("id", other.id)
    .eq("tour_id", tourId);
  return { error: secondError ? message(secondError, "Could not reorder scenes.") : null };
}
