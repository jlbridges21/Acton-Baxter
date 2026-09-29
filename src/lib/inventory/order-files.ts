import "server-only";

import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";

export const INVENTORY_FILES_BUCKET = "inventory-order-files";

type StoredFile = { bytes: Buffer; mimeType: string };

const globalMemory = globalThis as typeof globalThis & {
  __baxterInventoryFiles?: Map<string, StoredFile>;
};

function memory() {
  if (!globalMemory.__baxterInventoryFiles) globalMemory.__baxterInventoryFiles = new Map();
  return globalMemory.__baxterInventoryFiles;
}

export function resetInventoryFilesForTests() {
  globalMemory.__baxterInventoryFiles = new Map();
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sourcePdfPath(sha256: string): string {
  return `source/${sha256}.pdf`;
}

export function productPhotoPath(sha256: string, index: number): string {
  return `photos/${sha256}/${index}.png`;
}

async function putFile(path: string, bytes: Buffer, mimeType: string) {
  if (shouldUseMemory()) {
    memory().set(path, { bytes, mimeType });
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(INVENTORY_FILES_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) {
    throw new ValidationError(
      "Could not store the order file. Confirm the inventory-order-files bucket exists.",
    );
  }
}

export async function storeOrderPdf(
  buffer: Buffer,
): Promise<{ sha256: string; storagePath: string }> {
  const sha256 = sha256Hex(buffer);
  const storagePath = sourcePdfPath(sha256);
  await putFile(storagePath, buffer, "application/pdf");
  return { sha256, storagePath };
}

export async function storeProductPhoto(input: {
  sha256: string;
  index: number;
  png: Buffer;
}): Promise<string> {
  const storagePath = productPhotoPath(input.sha256, input.index);
  await putFile(storagePath, input.png, "image/png");
  return storagePath;
}

export async function readInventoryFile(storagePath: string): Promise<StoredFile | null> {
  if (shouldUseMemory()) return memory().get(storagePath) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(INVENTORY_FILES_BUCKET).download(storagePath);
  if (error || !data) return null;
  return {
    bytes: Buffer.from(await data.arrayBuffer()),
    mimeType: data.type || "application/octet-stream",
  };
}

export async function signInventoryFiles(
  storagePaths: string[],
  expiresInSeconds = 600,
): Promise<Map<string, string>> {
  const unique = [...new Set(storagePaths.filter(Boolean))];
  const signed = new Map<string, string>();
  if (!unique.length) return signed;
  if (shouldUseMemory()) {
    for (const storagePath of unique) {
      const url = await signInventoryFile(storagePath, expiresInSeconds);
      if (url) signed.set(storagePath, url);
    }
    return signed;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(INVENTORY_FILES_BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) return signed;
  for (const row of data) {
    if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
  }
  return signed;
}

export async function signInventoryFile(
  storagePath: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  if (shouldUseMemory()) {
    const file = memory().get(storagePath);
    if (!file) return null;
    return `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(INVENTORY_FILES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
