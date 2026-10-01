import { loadOrientedImage, renderScaledJpeg } from "@/lib/receipts/client-image";
import { equirectangularWarning } from "@/lib/tours/aspect";
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
 * Decode once for the thumbnail and, when the original is wider than 4096,
 * the compatibility JPEG. The original File is not rewritten.
 */
export async function derivePanoramaImages(file: File): Promise<PanoramaDerivatives> {
  const image = await loadOrientedImage(file);
  try {
    const thumbnail = await renderScaledJpeg(
      image.source,
      TOUR_THUMB_WIDTH,
      TOUR_THUMB_HEIGHT,
      TOUR_THUMB_JPEG_QUALITY,
    );
    const compat = needsCompatPanorama(image.width)
      ? await renderScaledJpeg(
          image.source,
          TOUR_COMPAT_WIDTH,
          TOUR_COMPAT_HEIGHT,
          TOUR_COMPAT_JPEG_QUALITY,
        )
      : null;
    return {
      width: image.width,
      height: image.height,
      warning: equirectangularWarning(image.width, image.height),
      thumbnail,
      compat,
    };
  } finally {
    image.cleanup();
  }
}
