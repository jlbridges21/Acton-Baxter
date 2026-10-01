import { renderScaledJpeg } from "@/lib/receipts/client-image";
import { equirectangularWarning } from "@/lib/tours/aspect";
import { readPanoramaDimensions } from "@/lib/tours/pixel-size";
import {
  TOUR_COMPAT_HEIGHT,
  TOUR_COMPAT_JPEG_QUALITY,
  TOUR_COMPAT_WIDTH,
  TOUR_PANORAMA_MAX_BYTES,
  TOUR_THUMB_HEIGHT,
  TOUR_THUMB_JPEG_QUALITY,
  TOUR_THUMB_WIDTH,
} from "@/lib/tours/constants";
import { needsCompatPanorama } from "@/lib/tours/paths";

export type PanoramaDerivatives = {
  width: number;
  height: number;
  warning: string | null;
  thumbnail: Blob;
  compat: Blob | null;
};

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

export function sniffPanoramaMime(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (JPEG.every((byte, index) => bytes[index] === byte)) return "image/jpeg";
  if (PNG.every((byte, index) => bytes[index] === byte)) return "image/png";
  return null;
}

export async function assertPanoramaFile(file: File): Promise<"image/jpeg" | "image/png"> {
  if (file.size > TOUR_PANORAMA_MAX_BYTES) {
    throw new Error("This file is over 200MB. The tour storage bucket will reject it.");
  }
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sniffed = sniffPanoramaMime(header);
  if (!sniffed) {
    throw new Error("Only JPEG and PNG panoramas can be uploaded.");
  }
  return sniffed;
}

/**
 * Thumbnail and compat JPEGs only. The original File is not decoded or rewritten.
 *
 * createImageBitmap resizeWidth/resizeHeight asks the browser to decode straight
 * to the target size. A 16384×8192 panorama is about 537MB of RGBA if decoded
 * in full; the compat bitmap is 4096×2048×4 ≈ 32MB, and the thumbnail is
 * 800×400×4 ≈ 1.3MB. Dimensions come from the file header, not from that bitmap.
 */
export async function derivePanoramaImages(file: File): Promise<PanoramaDerivatives> {
  const size = await readPanoramaDimensions(file);
  const thumbnail = await resizedPanoramaJpeg(
    file,
    size,
    TOUR_THUMB_WIDTH,
    TOUR_THUMB_HEIGHT,
    TOUR_THUMB_JPEG_QUALITY,
  );
  const compat = needsCompatPanorama(size.width)
    ? await resizedPanoramaJpeg(
        file,
        size,
        TOUR_COMPAT_WIDTH,
        TOUR_COMPAT_HEIGHT,
        TOUR_COMPAT_JPEG_QUALITY,
      )
    : null;
  return {
    width: size.width,
    height: size.height,
    warning: equirectangularWarning(size.width, size.height),
    thumbnail,
    compat,
  };
}

async function resizedPanoramaJpeg(
  file: File,
  source: { width: number; height: number },
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot resize a panorama. The full image was not decoded.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : "The image could not be decoded.";
    throw new Error(`Could not process this panorama. ${reason}`);
  }
  try {
    if (
      (source.width > width || source.height > height) &&
      (bitmap.width > width || bitmap.height > height)
    ) {
      throw new Error(
        "This browser decoded the full panorama instead of the resized copy, so the image was not processed.",
      );
    }
    return await renderScaledJpeg(bitmap, width, height, quality);
  } finally {
    bitmap.close();
  }
}
