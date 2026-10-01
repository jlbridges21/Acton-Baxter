"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import {
  collectSceneStoragePaths,
  collectTourStoragePaths,
  tourSceneObjectPaths,
  type PanoramaExtension,
} from "@/lib/tours/paths";
import {
  createTourPanoramaUpload,
  removeTourPanoramaObjects,
  type SignedUpload,
} from "@/lib/tours/storage";
import {
  deleteSceneRow,
  deleteTourRow,
  getScenePath,
  getTourSlug,
  insertScene,
  insertTour,
  listScenePaths,
  setCoverScene,
  setScenePositions,
  swapScenePosition,
  tourExists,
  updateHotspot,
  updateSceneName,
  updateTourTitle,
  updateTourVisibility,
  clearSceneOpeningView as clearSceneOpeningViewRow,
  deleteHotspotRow,
  hotspotBelongsToScene,
  insertHotspot,
  setSceneOpeningView as setSceneOpeningViewRow,
} from "@/lib/tours/store";

const tourIdSchema = z.string().uuid();
const sceneIdSchema = z.string().uuid();
const extensionSchema = z.enum(["jpg", "png"]);

async function refreshTour(tourId: string): Promise<void> {
  revalidatePath("/tours");
  revalidatePath(`/tours/${tourId}`);
  revalidatePath(`/tours/${tourId}/preview`);
  const slug = await getTourSlug(tourId);
  if (!slug) return;
  revalidatePath(`/tour/${slug}`);
  revalidatePath(`/embed/${slug}`);
}

function fail(error: unknown, fallback: string): { error: string } {
  if (error instanceof Error && error.message) return { error: error.message };
  return { error: fallback };
}

async function requireTour(tourId: string): Promise<{ error: string } | null> {
  await requireActiveUser();
  if (!tourIdSchema.safeParse(tourId).success) return { error: "That tour was not found." };
  if (!(await tourExists(tourId))) return { error: "That tour was not found." };
  return null;
}

export async function createTour(): Promise<{ error: string | null; tourId: string | null }> {
  try {
    const user = await requireActiveUser();
    const created = await insertTour(user.id);
    if (!created.error) revalidatePath("/tours");
    return created;
  } catch (error) {
    return { ...fail(error, "Could not create the tour."), tourId: null };
  }
}

export async function renameTour(tourId: string, title: string): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  const next = title.trim() || "Untitled Tour";
  const result = await updateTourTitle(tourId, next);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function setTourPublic(
  tourId: string,
  isPublic: boolean,
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  const result = await updateTourVisibility(tourId, isPublic);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function deleteTour(tourId: string): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  try {
    const scenes = await listScenePaths(tourId);
    const paths = collectTourStoragePaths(
      scenes.map((scene) => ({
        storagePath: scene.storage_path,
        compatPath: scene.compat_path,
        thumbnailPath: scene.thumbnail_path,
      })),
    );
    await removeTourPanoramaObjects(paths);
  } catch (error) {
    return fail(error, "Could not delete the panorama files, so the tour was kept.");
  }
  const slug = await getTourSlug(tourId);
  const result = await deleteTourRow(tourId);
  if (!result.error) {
    revalidatePath("/tours");
    if (slug) {
      revalidatePath(`/tour/${slug}`);
      revalidatePath(`/embed/${slug}`);
    }
  }
  return result;
}

export async function prepareSceneUpload(input: {
  tourId: string;
  sceneId: string;
  includeCompat: boolean;
  extension: PanoramaExtension;
}): Promise<{
  error: string | null;
  storagePath?: string;
  compatPath?: string | null;
  thumbnailPath?: string;
  storage?: SignedUpload;
  compat?: SignedUpload | null;
  thumbnail?: SignedUpload;
}> {
  const missing = await requireTour(input.tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(input.sceneId).success) {
    return { error: "Could not start this upload." };
  }
  if (!extensionSchema.safeParse(input.extension).success) {
    return { error: "Only JPEG and PNG panoramas can be uploaded." };
  }
  const paths = tourSceneObjectPaths(input.tourId, input.sceneId, {
    compat: input.includeCompat,
    extension: input.extension,
  });
  try {
    const storage = await createTourPanoramaUpload(paths.storagePath);
    const thumbnail = await createTourPanoramaUpload(paths.thumbnailPath);
    const compat = paths.compatPath ? await createTourPanoramaUpload(paths.compatPath) : null;
    return {
      error: null,
      storagePath: paths.storagePath,
      compatPath: paths.compatPath,
      thumbnailPath: paths.thumbnailPath,
      storage,
      thumbnail,
      compat,
    };
  } catch (error) {
    return fail(error, "Could not prepare the panorama upload.");
  }
}

export async function saveScene(input: {
  tourId: string;
  sceneId: string;
  name: string;
  width: number;
  height: number;
  includeCompat: boolean;
  extension: PanoramaExtension;
}): Promise<{ error: string | null }> {
  const missing = await requireTour(input.tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(input.sceneId).success)
    return { error: "Could not save the scene." };
  if (!extensionSchema.safeParse(input.extension).success) {
    return { error: "Only JPEG and PNG panoramas can be uploaded." };
  }
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width < 1 ||
    input.height < 1
  ) {
    return { error: "Could not read this panorama's size." };
  }
  const paths = tourSceneObjectPaths(input.tourId, input.sceneId, {
    compat: input.includeCompat,
    extension: input.extension,
  });
  const result = await insertScene({
    id: input.sceneId,
    tourId: input.tourId,
    name: input.name.trim() || "Scene",
    storagePath: paths.storagePath,
    compatPath: paths.compatPath,
    thumbnailPath: paths.thumbnailPath,
    width: Math.round(input.width),
    height: Math.round(input.height),
  });
  if (!result.error) await refreshTour(input.tourId);
  return result;
}

export async function discardSceneUpload(
  tourId: string,
  sceneId: string,
  extension: PanoramaExtension,
): Promise<void> {
  const missing = await requireTour(tourId);
  if (missing) return;
  if (!sceneIdSchema.safeParse(sceneId).success) return;
  if (!extensionSchema.safeParse(extension).success) return;
  const paths = tourSceneObjectPaths(tourId, sceneId, { compat: true, extension });
  await removeTourPanoramaObjects(collectSceneStoragePaths(paths)).catch(() => undefined);
}

export async function renameScene(
  tourId: string,
  sceneId: string,
  name: string,
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(sceneId).success) return { error: "That scene was not found." };
  let scene;
  try {
    scene = await getScenePath(tourId, sceneId);
  } catch (error) {
    return fail(error, "Could not load that scene.");
  }
  if (!scene) return { error: "That scene was not found." };
  const result = await updateSceneName(tourId, sceneId, name.trim() || "Scene");
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function setTourCover(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(sceneId).success) return { error: "That scene was not found." };
  let result;
  try {
    result = await setCoverScene(tourId, sceneId);
  } catch (error) {
    return fail(error, "Could not set the cover scene.");
  }
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function reorderScenes(
  tourId: string,
  sceneIds: string[],
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (sceneIds.some((id) => !sceneIdSchema.safeParse(id).success)) {
    return { error: "Could not reorder scenes." };
  }
  const result = await setScenePositions(tourId, sceneIds);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function moveScene(
  tourId: string,
  sceneId: string,
  direction: "up" | "down",
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(sceneId).success) return { error: "That scene was not found." };
  const result = await swapScenePosition(tourId, sceneId, direction);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function deleteScene(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(sceneId).success) return { error: "That scene was not found." };
  let scene;
  try {
    scene = await getScenePath(tourId, sceneId);
  } catch (error) {
    return fail(error, "Could not load that scene.");
  }
  if (!scene) return { error: "That scene was not found." };
  try {
    await removeTourPanoramaObjects(
      collectSceneStoragePaths({
        storagePath: scene.storage_path,
        compatPath: scene.compat_path,
        thumbnailPath: scene.thumbnail_path,
      }),
    );
  } catch (error) {
    return fail(error, "Could not delete the panorama files, so the scene was kept.");
  }
  const result = await deleteSceneRow(tourId, sceneId);
  if (!result.error) await refreshTour(tourId);
  return result;
}

const hotspotIdSchema = z.string().uuid();
const hotspotShapeSchema = z.enum(["arrow", "circle", "square"]);
const radiansSchema = z.number().finite();

const hotspotFieldsSchema = z.object({
  type: z.enum(["link", "info"]),
  yaw: radiansSchema,
  pitch: radiansSchema,
  label: z.string().trim().max(120).nullable(),
  content: z.string().trim().max(2000).nullable(),
  targetSceneId: z.string().uuid().nullable(),
  styleShape: hotspotShapeSchema,
  styleColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  styleSize: z.number().int().min(16).max(128),
});

async function requireScene(tourId: string, sceneId: string): Promise<{ error: string } | null> {
  const missing = await requireTour(tourId);
  if (missing) return missing;
  if (!sceneIdSchema.safeParse(sceneId).success) return { error: "That scene was not found." };
  try {
    const scene = await getScenePath(tourId, sceneId);
    if (!scene) return { error: "That scene was not found." };
  } catch (error) {
    return fail(error, "Could not load that scene.");
  }
  return null;
}

async function requireTarget(
  tourId: string,
  sceneId: string,
  targetSceneId: string | null,
): Promise<{ error: string } | null> {
  if (!targetSceneId) return null;
  if (targetSceneId === sceneId) return { error: "A hotspot cannot link to its own scene." };
  try {
    const target = await getScenePath(tourId, targetSceneId);
    if (!target) return { error: "That target scene was not found." };
  } catch (error) {
    return fail(error, "Could not load the target scene.");
  }
  return null;
}

export async function createHotspot(input: {
  tourId: string;
  sceneId: string;
  hotspotId: string;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  targetSceneId: string | null;
  styleShape: "arrow" | "circle" | "square";
  styleColor: string;
  styleSize: number;
}): Promise<{ error: string | null }> {
  const missing = await requireScene(input.tourId, input.sceneId);
  if (missing) return missing;
  if (!hotspotIdSchema.safeParse(input.hotspotId).success) {
    return { error: "Could not create the hotspot." };
  }
  const fields = hotspotFieldsSchema.safeParse(input);
  if (!fields.success) return { error: "Could not create the hotspot." };
  const target = await requireTarget(input.tourId, input.sceneId, fields.data.targetSceneId);
  if (target) return target;
  const result = await insertHotspot({
    id: input.hotspotId,
    tourId: input.tourId,
    sceneId: input.sceneId,
    targetSceneId: fields.data.type === "info" ? null : fields.data.targetSceneId,
    type: fields.data.type,
    yaw: fields.data.yaw,
    pitch: fields.data.pitch,
    label: fields.data.label,
    content: fields.data.content,
    styleShape: fields.data.styleShape,
    styleColor: fields.data.styleColor,
    styleSize: fields.data.styleSize,
  });
  if (!result.error) await refreshTour(input.tourId);
  return result;
}

export async function saveHotspot(input: {
  tourId: string;
  sceneId: string;
  hotspotId: string;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  targetSceneId: string | null;
  styleShape: "arrow" | "circle" | "square";
  styleColor: string;
  styleSize: number;
}): Promise<{ error: string | null }> {
  const missing = await requireScene(input.tourId, input.sceneId);
  if (missing) return missing;
  if (!hotspotIdSchema.safeParse(input.hotspotId).success) {
    return { error: "That hotspot was not found." };
  }
  const fields = hotspotFieldsSchema.safeParse(input);
  if (!fields.success) return { error: "Could not update the hotspot." };
  const target = await requireTarget(input.tourId, input.sceneId, fields.data.targetSceneId);
  if (target) return target;
  try {
    const owned = await hotspotBelongsToScene(input.sceneId, input.hotspotId);
    if (!owned) return { error: "That hotspot was not found." };
  } catch (error) {
    return fail(error, "Could not load that hotspot.");
  }
  const result = await updateHotspot({
    id: input.hotspotId,
    sceneId: input.sceneId,
    targetSceneId: fields.data.type === "info" ? null : fields.data.targetSceneId,
    type: fields.data.type,
    yaw: fields.data.yaw,
    pitch: fields.data.pitch,
    label: fields.data.label,
    content: fields.data.content,
    styleShape: fields.data.styleShape,
    styleColor: fields.data.styleColor,
    styleSize: fields.data.styleSize,
  });
  if (!result.error) await refreshTour(input.tourId);
  return result;
}

export async function deleteHotspot(
  tourId: string,
  sceneId: string,
  hotspotId: string,
): Promise<{ error: string | null }> {
  const missing = await requireScene(tourId, sceneId);
  if (missing) return missing;
  if (!hotspotIdSchema.safeParse(hotspotId).success) {
    return { error: "That hotspot was not found." };
  }
  try {
    const owned = await hotspotBelongsToScene(sceneId, hotspotId);
    if (!owned) return { error: "That hotspot was not found." };
  } catch (error) {
    return fail(error, "Could not load that hotspot.");
  }
  const result = await deleteHotspotRow(sceneId, hotspotId);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function setSceneOpeningView(
  tourId: string,
  sceneId: string,
  yaw: number,
  pitch: number,
): Promise<{ error: string | null }> {
  const missing = await requireScene(tourId, sceneId);
  if (missing) return missing;
  if (!radiansSchema.safeParse(yaw).success || !radiansSchema.safeParse(pitch).success) {
    return { error: "Could not save the opening view." };
  }
  const result = await setSceneOpeningViewRow(tourId, sceneId, yaw, pitch);
  if (!result.error) await refreshTour(tourId);
  return result;
}

export async function clearSceneOpeningView(
  tourId: string,
  sceneId: string,
): Promise<{ error: string | null }> {
  const missing = await requireScene(tourId, sceneId);
  if (missing) return missing;
  const result = await clearSceneOpeningViewRow(tourId, sceneId);
  if (!result.error) await refreshTour(tourId);
  return result;
}
