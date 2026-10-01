import { TOUR_COMPAT_MAX_WIDTH } from "@/lib/tours/constants";

export function needsCompatPanorama(width: number): boolean {
  return width > TOUR_COMPAT_MAX_WIDTH;
}

export type PanoramaExtension = "jpg" | "png";

/** Match the stored object to the bytes. PNG must not be written under `.jpg`. */
export function panoramaExtension(mime: "image/jpeg" | "image/png"): PanoramaExtension {
  return mime === "image/png" ? "png" : "jpg";
}

/**
 * Original bytes live at `{tourId}/{sceneId}.{ext}`.
 * Rows already saved as `.jpg` stay valid: reads use the `storage_path` column,
 * they do not rebuild this name.
 */
export function tourSceneObjectPaths(
  tourId: string,
  sceneId: string,
  options: { compat: boolean; extension: PanoramaExtension },
): { storagePath: string; compatPath: string | null; thumbnailPath: string } {
  const base = `${tourId}/${sceneId}`;
  return {
    storagePath: `${base}.${options.extension}`,
    compatPath: options.compat ? `${base}-compat.jpg` : null,
    thumbnailPath: `${base}-thumb.jpg`,
  };
}

export type SceneStorageFields = {
  storagePath: string;
  compatPath?: string | null;
  thumbnailPath?: string | null;
};

/** Every object a scene owns. Used before the row is deleted so the paths are not lost. */
export function collectSceneStoragePaths(scene: SceneStorageFields): string[] {
  return [scene.storagePath, scene.compatPath, scene.thumbnailPath].filter((path): path is string =>
    Boolean(path && path.trim()),
  );
}

export function collectTourStoragePaths(scenes: SceneStorageFields[]): string[] {
  return Array.from(new Set(scenes.flatMap((scene) => collectSceneStoragePaths(scene))));
}
