import { orientedDimensions, readJpegExifOrientation } from "@/lib/receipts/client-image";

const HEADER_BYTES = 512 * 1024;

/**
 * Pixel size from the file header only. This does not decode the bitmap.
 * A 16384×8192 panorama is about 537MB of RGBA; reading SOF/IHDR stays in the
 * header and never allocates that buffer.
 */
export async function readPanoramaDimensions(
  file: Blob,
): Promise<{ width: number; height: number }> {
  const prefix = new Uint8Array(
    await file.slice(0, Math.min(file.size, HEADER_BYTES)).arrayBuffer(),
  );
  const raw = pngSize(prefix) ?? jpegSize(prefix);
  if (!raw) {
    throw new Error("Could not read this panorama's size.");
  }
  const orientation = readJpegExifOrientation(prefix);
  return orientedDimensions(raw.width, raw.height, orientation);
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const ihdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!ihdr) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) return null;
    if (isStartOfFrame(marker)) {
      if (size < 7) return null;
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    offset += size;
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}
