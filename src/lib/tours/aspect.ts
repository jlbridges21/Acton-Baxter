import { EQUIRECT_RATIO, EQUIRECT_TOLERANCE } from "@/lib/tours/constants";

/** Warn, don't block, when the image is probably not equirectangular. */
export function equirectangularWarning(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "Could not read this image's size.";
  }
  const ratio = width / height;
  const min = EQUIRECT_RATIO * (1 - EQUIRECT_TOLERANCE);
  const max = EQUIRECT_RATIO * (1 + EQUIRECT_TOLERANCE);
  if (ratio < min || ratio > max) {
    return `This image is ${width}×${height}, not a 2:1 panorama. It will still upload.`;
  }
  return null;
}
