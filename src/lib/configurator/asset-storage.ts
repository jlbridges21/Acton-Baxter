/**
 * Where rendering files live and how browsers reach them.
 * - Supabase mode: public bucket `configurator-assets`, served from the Supabase CDN.
 * - Memory/local mode: files under `.configurator-local/assets`, served by
 *   /api/public/configurator/assets/[...path].
 */

import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/admin";
import { AppError, ValidationError } from "@/lib/errors";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  assetStoragePaths,
  processImage,
} from "./image-processing";
import {
  CONFIGURATOR_BUCKET,
  findAssetBySha,
  insertAsset,
  usesMemoryConfiguratorStore,
} from "./store";
import type { Asset, AssetClassification, PublicAssetRef } from "./types";

export function storageObjectUrl(objectPath: string): string {
  if (usesMemoryConfiguratorStore()) return `/api/public/configurator/assets/${objectPath}`;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${CONFIGURATOR_BUCKET}/${objectPath}`;
}

export function assetRef(paths: { displayPath: string; thumbPath: string }): PublicAssetRef {
  return { display: storageObjectUrl(paths.displayPath), thumb: storageObjectUrl(paths.thumbPath) };
}

/** Resolve a storage key inside the local asset directory, refusing path traversal. */
export function localAssetFile(objectPath: string): string | null {
  if (!/^(renders|thumbs)\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/.test(objectPath)) return null;
  const [folder, shard, name] = objectPath.split("/") as [string, string, string];
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    ".configurator-local",
    "assets",
    folder,
    shard,
    name,
  );
}

export async function readLocalAsset(objectPath: string): Promise<Buffer | null> {
  const file = localAssetFile(objectPath);
  if (!file) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function putObject(objectPath: string, body: Buffer): Promise<void> {
  if (usesMemoryConfiguratorStore()) {
    const file = localAssetFile(objectPath);
    if (!file) throw new AppError("Invalid asset path", { statusCode: 500 });
    const [folder, shard] = objectPath.split("/") as [string, string];
    await mkdir(
      path.join(
        /*turbopackIgnore: true*/ process.cwd(),
        ".configurator-local",
        "assets",
        folder,
        shard,
      ),
      {
        recursive: true,
      },
    );
    await writeFile(file, body);
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(CONFIGURATOR_BUCKET).upload(objectPath, body, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: true,
  });
  if (error)
    throw new AppError(`Image upload failed: ${error.message}`, {
      statusCode: 502,
      code: "CONFIGURATOR_UPLOAD",
    });
}

export type StoreImageInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  source: Asset["source"];
  provenance: string;
  classification: AssetClassification | null;
  userId: string | null;
};

/** Process, store and register an image. Identical files are stored once. */
export async function storeImage(
  input: StoreImageInput,
): Promise<{ asset: Asset; duplicate: boolean }> {
  if (!ACCEPTED_IMAGE_TYPES.includes(input.mimeType as (typeof ACCEPTED_IMAGE_TYPES)[number]))
    throw new ValidationError("Upload a JPG, PNG or WEBP image.");
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES)
    throw new ValidationError("That image is larger than 40 MB.");
  const processed = await processImage(input.buffer).catch(() => {
    throw new ValidationError("That file could not be read as an image.");
  });
  const existing = await findAssetBySha(processed.sha256);
  if (existing) return { asset: existing, duplicate: true };
  const paths = assetStoragePaths(processed.sha256);
  await putObject(paths.displayPath, processed.display);
  await putObject(paths.thumbPath, processed.thumb);
  const asset = await insertAsset(
    {
      ...paths,
      width: processed.width,
      height: processed.height,
      bytes: input.buffer.byteLength,
      sha256: processed.sha256,
      originalName: input.originalName.slice(0, 300),
      source: input.source,
      provenance: input.provenance.slice(0, 1000),
      classification: input.classification,
    },
    input.userId,
  );
  return { asset, duplicate: false };
}
