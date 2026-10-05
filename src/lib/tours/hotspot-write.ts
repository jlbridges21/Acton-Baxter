import type { HotspotPlacement, HotspotShape } from "@/lib/tours/hotspot-shapes";

/**
 * Every column the editor owns. `created_at` stays a database default so a
 * conflict update does not reset it. Naming each field keeps a retry from
 * writing a partial row.
 */
export const HOTSPOT_WRITE_COLUMNS = [
  "id",
  "scene_id",
  "target_scene_id",
  "type",
  "yaw",
  "pitch",
  "label",
  "content",
  "style_shape",
  "style_color",
  "style_size",
  "style_rotation",
  "style_placement",
] as const;

export type HotspotWriteRow = {
  id: string;
  scene_id: string;
  target_scene_id: string | null;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  style_shape: HotspotShape;
  style_color: string;
  style_size: number;
  style_rotation: number;
  style_placement: HotspotPlacement;
};

export type HotspotWriteInput = {
  id: string;
  sceneId: string;
  targetSceneId: string | null;
  type: "link" | "info";
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  styleShape: HotspotShape;
  styleColor: string;
  styleSize: number;
  styleRotation: number;
  stylePlacement: HotspotPlacement;
};

export function hotspotWriteRow(input: HotspotWriteInput): HotspotWriteRow {
  const row: HotspotWriteRow = {
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
  };
  for (const column of HOTSPOT_WRITE_COLUMNS) {
    if (!(column in row)) throw new Error(`Hotspot write omitted ${column}.`);
  }
  return row;
}

/**
 * A row that already belongs to another scene is not this write's to replace.
 * A missing row and a row on this scene both become a full-row write.
 */
export function resolveHotspotWrite(
  existing: { scene_id: string } | null,
  row: HotspotWriteRow,
): { action: "reject"; error: string } | { action: "write"; row: HotspotWriteRow } {
  if (existing && existing.scene_id !== row.scene_id) {
    return { action: "reject", error: "That hotspot was not found." };
  }
  return { action: "write", row };
}

export function isPrimaryKeyConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "23505") return true;
  const text = error instanceof Error ? error.message : "";
  return text.includes("hotspots_pkey");
}

export type HotspotRowStore = {
  findSceneId(id: string): Promise<string | null>;
  write(row: HotspotWriteRow): Promise<void>;
};

/**
 * One full-row write. A primary-key conflict means the row already landed, so
 * the same payload is written again instead of failing the retry.
 */
export async function writeHotspotIdempotently(
  store: HotspotRowStore,
  row: HotspotWriteRow,
): Promise<{ error: string | null }> {
  try {
    return await writeResolved(store, row);
  } catch (error) {
    if (!isPrimaryKeyConflict(error)) return { error: writeError(error) };
    try {
      return await writeResolved(store, row);
    } catch (retryError) {
      if (isPrimaryKeyConflict(retryError)) {
        return { error: "Could not save the hotspot." };
      }
      return { error: writeError(retryError) };
    }
  }
}

async function writeResolved(
  store: HotspotRowStore,
  row: HotspotWriteRow,
): Promise<{ error: string | null }> {
  const sceneId = await store.findSceneId(row.id);
  const decision = resolveHotspotWrite(sceneId === null ? null : { scene_id: sceneId }, row);
  if (decision.action === "reject") return { error: decision.error };
  await store.write(decision.row);
  return { error: null };
}

function writeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Could not save the hotspot.";
}
