/**
 * Rotate receipt JPEG/PNG buffers for vision retry (in-frame paper orientation).
 * Uses sharp when available (pulled in via Next.js); falls back to no-op.
 */

import "server-only";

export type ReceiptRotationDegrees = 0 | 90 | 180 | 270;

export async function rotateReceiptImageBuffer(
  buffer: Buffer,
  degrees: ReceiptRotationDegrees,
): Promise<Buffer> {
  if (degrees === 0) return buffer;
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    return await sharp(buffer).rotate(degrees).jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    console.warn(
      "rotateReceiptImageBuffer: sharp unavailable, returning original buffer",
      error instanceof Error ? error.message : error,
    );
    return buffer;
  }
}
