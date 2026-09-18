/**
 * Browser-side receipt photo pipeline:
 * decode → apply EXIF orientation → resize → JPEG encode.
 *
 * Solves HEIC (iOS Safari decode → JPEG), size (job-site cell), and sideways EXIF.
 */

export const RECEIPT_IMAGE_MAX_EDGE = 1800;
export const RECEIPT_JPEG_QUALITY = 0.8;

export type ProcessedReceiptImage = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  processedBytes: number;
  mimeType: "image/jpeg";
};

export class ReceiptImageProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptImageProcessError";
  }
}

/** Read JPEG EXIF orientation (1–8). Returns 1 when absent / non-JPEG. */
export function readJpegExifOrientation(input: ArrayBuffer | Uint8Array): number {
  const view =
    input instanceof ArrayBuffer
      ? new DataView(input)
      : new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xffda) break;
    if (offset + 2 > view.byteLength) break;
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > view.byteLength) break;

    if (marker === 0xffe1) {
      const start = offset + 2;
      if (start + 6 > view.byteLength) break;
      const isExif =
        view.getUint8(start) === 0x45 &&
        view.getUint8(start + 1) === 0x78 &&
        view.getUint8(start + 2) === 0x69 &&
        view.getUint8(start + 3) === 0x66 &&
        view.getUint8(start + 4) === 0x00 &&
        view.getUint8(start + 5) === 0x00;
      if (!isExif) {
        offset += size;
        continue;
      }
      const tiff = start + 6;
      if (tiff + 8 > view.byteLength) break;
      const little = view.getUint16(tiff) === 0x4949;
      const get16 = (o: number) => (little ? view.getUint16(o, true) : view.getUint16(o, false));
      const get32 = (o: number) => (little ? view.getUint32(o, true) : view.getUint32(o, false));
      if (get16(tiff + 2) !== 0x002a) break;
      let dir = tiff + get32(tiff + 4);
      if (dir + 2 > view.byteLength) break;
      const entries = get16(dir);
      dir += 2;
      for (let i = 0; i < entries; i += 1) {
        const entry = dir + i * 12;
        if (entry + 12 > view.byteLength) break;
        if (get16(entry) === 0x0112) {
          const value = get16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      break;
    }
    offset += size;
  }
  return 1;
}

export function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/** Draw source onto canvas with EXIF orientation transform applied. */
export function drawOrientedImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  orientation: number,
): void {
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }
  ctx.drawImage(source, 0, 0, width, height);
}

export function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new ReceiptImageProcessError("Could not encode the photo as JPEG."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Prevent the browser from applying EXIF before we draw — same double-rotation
    // hazard as createImageBitmap's default `from-image` (CSS default is also from-image).
    img.style.imageOrientation = "none";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new ReceiptImageProcessError(
          "Could not read this photo. If it is an iPhone HEIC, try “Take photo” or convert to JPEG, then enter fields manually.",
        ),
      );
    img.src = url;
  });
}

async function decodeImageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  /** True when the decoder already applied EXIF (createImageBitmap default). */
  appliedExif: boolean;
  cleanup: () => void;
}> {
  // Prefer createImageBitmap with default `from-image`: the browser bakes EXIF once.
  // Do NOT also run drawOrientedImage on that bitmap — that double-rotates 5–8.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        appliedExif: true,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement (needed for some HEIC paths on iOS).
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    // Prefer a raw bitmap from the img when available (imageOrientation none again).
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(img, { imageOrientation: "none" });
        URL.revokeObjectURL(objectUrl);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          appliedExif: false,
          cleanup: () => bitmap.close(),
        };
      } catch {
        /* use the HTMLImageElement directly */
      }
    }
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      appliedExif: false,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/**
 * Decode selected file, fix orientation, resize long edge, encode JPEG ~0.8.
 *
 * Orientation strategy (avoid double-rotation):
 * - createImageBitmap path: let the browser bake EXIF (`from-image` default) and
 *   skip manual transforms.
 * - HTMLImageElement fallback: force `imageOrientation: none` and apply EXIF via
 *   drawOrientedImage (same as receipts).
 */
export async function processReceiptImage(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<ProcessedReceiptImage> {
  const maxEdge = options?.maxEdge ?? RECEIPT_IMAGE_MAX_EDGE;
  const quality = options?.quality ?? RECEIPT_JPEG_QUALITY;
  const originalBytes = file.size;

  const arrayBuffer = await file.arrayBuffer();
  const exifOrientation = readJpegExifOrientation(arrayBuffer);

  let cleanup: (() => void) | null = null;
  try {
    const decoded = await decodeImageSource(file);
    cleanup = decoded.cleanup;

    if (!decoded.width || !decoded.height) {
      throw new ReceiptImageProcessError(
        "Could not read this photo. Try “Take photo”, or continue with manual entry.",
      );
    }

    // Bitmap path already applied EXIF; only the HTMLImageElement fallback needs manual transform.
    const orientation = decoded.appliedExif ? 1 : exifOrientation;
    const oriented = orientedDimensions(decoded.width, decoded.height, orientation);
    const target = scaleToMaxEdge(oriented.width, oriented.height, maxEdge);

    const orientedCanvas = document.createElement("canvas");
    orientedCanvas.width = oriented.width;
    orientedCanvas.height = oriented.height;
    const orientedCtx = orientedCanvas.getContext("2d");
    if (!orientedCtx) {
      throw new ReceiptImageProcessError("Could not process this photo on this device.");
    }
    drawOrientedImage(orientedCtx, decoded.source, decoded.width, decoded.height, orientation);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ReceiptImageProcessError("Could not process this photo on this device.");
    }
    ctx.drawImage(orientedCanvas, 0, 0, target.width, target.height);

    const blob = await canvasToJpegBlob(canvas, quality);
    return {
      blob,
      width: target.width,
      height: target.height,
      originalBytes,
      processedBytes: blob.size,
      mimeType: "image/jpeg",
    };
  } catch (error) {
    if (error instanceof ReceiptImageProcessError) throw error;
    throw new ReceiptImageProcessError(
      "Could not read this photo. Try “Take photo”, or continue with manual entry.",
    );
  } finally {
    cleanup?.();
  }
}
