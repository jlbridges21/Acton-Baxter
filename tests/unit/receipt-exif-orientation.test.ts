/**
 * @vitest-environment jsdom
 *
 * EXIF orientation fixtures — orientations 1, 3, 6, 8 must produce correct
 * display dimensions and transforms. The double-rotation bug came from
 * createImageBitmap defaulting to from-image while we also applied EXIF manually.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  drawOrientedImage,
  orientedDimensions,
  processReceiptImage,
  readJpegExifOrientation,
} from "@/lib/receipts/client-image";

/** Minimal JPEG (1×1) without EXIF. */
function minimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0x7f, 0xff, 0xd9,
  ]);
}

/** JPEG with a single Orientation EXIF SHORT (little-endian TIFF). */
function jpegWithOrientation(orientation: number): Buffer {
  const exifBody = Buffer.alloc(100);
  exifBody.write("Exif\0\0", 0, "binary");
  exifBody.writeUInt16LE(0x4949, 6);
  exifBody.writeUInt16LE(0x002a, 8);
  exifBody.writeUInt32LE(8, 10);
  const ifd = 14;
  exifBody.writeUInt16LE(1, ifd);
  exifBody.writeUInt16LE(0x0112, ifd + 2);
  exifBody.writeUInt16LE(3, ifd + 4);
  exifBody.writeUInt32LE(1, ifd + 6);
  exifBody.writeUInt16LE(orientation, ifd + 10);
  exifBody.writeUInt16LE(0, ifd + 12);

  const app1Length = exifBody.length + 2;
  const app1 = Buffer.alloc(2 + 2 + exifBody.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(app1Length, 2);
  exifBody.copy(app1, 4);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, minimalJpeg().subarray(2)]);
}

/**
 * Software pixel grid (row-major). Marker in top-left raw pixel = 1, bottom-right = 9.
 * Used to verify EXIF transforms move the marker to the expected display corner.
 */
function makeSensor(w: number, h: number): { w: number; h: number; data: number[] } {
  const data = new Array(w * h).fill(0);
  data[0] = 1; // top-left
  data[w * h - 1] = 9; // bottom-right
  return { w, h, data };
}

function get(sensor: { w: number; data: number[] }, x: number, y: number) {
  return sensor.data[y * sensor.w + x]!;
}

/**
 * Apply EXIF orientation to a raw sensor buffer → upright display buffer.
 * Sampling matches the canvas transforms in drawOrientedImage.
 */
function applyExifPixels(
  sensor: { w: number; h: number; data: number[] },
  orientation: number,
): { w: number; h: number; data: number[] } {
  const { width: outW, height: outH } = orientedDimensions(sensor.w, sensor.h, orientation);
  const out = new Array(outW * outH).fill(0);
  for (let dy = 0; dy < outH; dy += 1) {
    for (let dx = 0; dx < outW; dx += 1) {
      let sx = dx;
      let sy = dy;
      switch (orientation) {
        case 2:
          sx = sensor.w - 1 - dx;
          sy = dy;
          break;
        case 3:
          sx = sensor.w - 1 - dx;
          sy = sensor.h - 1 - dy;
          break;
        case 4:
          sx = dx;
          sy = sensor.h - 1 - dy;
          break;
        case 5:
          sx = dy;
          sy = dx;
          break;
        case 6:
          sx = dy;
          sy = sensor.h - 1 - dx;
          break;
        case 7:
          sx = sensor.w - 1 - dy;
          sy = sensor.h - 1 - dx;
          break;
        case 8:
          sx = sensor.w - 1 - dy;
          sy = dx;
          break;
        default:
          sx = dx;
          sy = dy;
      }
      if (sx >= 0 && sy >= 0 && sx < sensor.w && sy < sensor.h) {
        out[dy * outW + dx] = get(sensor, sx, sy);
      }
    }
  }
  return { w: outW, h: outH, data: out };
}

describe("EXIF orientation fixtures 1/3/6/8", () => {
  it("reads orientation tags from JPEG fixtures", () => {
    expect(readJpegExifOrientation(jpegWithOrientation(1))).toBe(1);
    expect(readJpegExifOrientation(jpegWithOrientation(3))).toBe(3);
    expect(readJpegExifOrientation(jpegWithOrientation(6))).toBe(6);
    expect(readJpegExifOrientation(jpegWithOrientation(8))).toBe(8);
    expect(readJpegExifOrientation(minimalJpeg())).toBe(1);
  });

  it("oriented dimensions: 1 and 3 keep size; 6 and 8 swap", () => {
    // Landscape phone sensor often stored as portrait buffer with ori 6/8
    expect(orientedDimensions(4032, 3024, 1)).toEqual({ width: 4032, height: 3024 });
    expect(orientedDimensions(4032, 3024, 3)).toEqual({ width: 4032, height: 3024 });
    expect(orientedDimensions(3024, 4032, 6)).toEqual({ width: 4032, height: 3024 });
    expect(orientedDimensions(3024, 4032, 8)).toEqual({ width: 4032, height: 3024 });
  });

  it("pixel markers land in the correct display corner after orientation", () => {
    const sensor = makeSensor(4, 2); // landscape raw buffer

    const o1 = applyExifPixels(sensor, 1);
    expect(o1).toEqual({ w: 4, h: 2, data: expect.any(Array) });
    expect(get(o1, 0, 0)).toBe(1);
    expect(get(o1, 3, 1)).toBe(9);

    const o3 = applyExifPixels(sensor, 3);
    expect(o3.w).toBe(4);
    expect(o3.h).toBe(2);
    expect(get(o3, 3, 1)).toBe(1); // TL → BR
    expect(get(o3, 0, 0)).toBe(9); // BR → TL

    const portraitSensor = makeSensor(2, 4); // portrait raw (phone landscape shot, ori 6)
    const o6 = applyExifPixels(portraitSensor, 6);
    expect(o6.w).toBe(4);
    expect(o6.h).toBe(2);
    // After 90° CW, raw TL (0,0) → display top-right (w-1, 0) = (3,0)
    expect(get(o6, 3, 0)).toBe(1);
    // raw BR (1,3) → display bottom-left (0,1)
    expect(get(o6, 0, 1)).toBe(9);

    const o8 = applyExifPixels(portraitSensor, 8);
    expect(o8.w).toBe(4);
    expect(o8.h).toBe(2);
    // 90° CCW: raw TL (0,0) → display bottom-left (0, h-1) = (0,1)
    expect(get(o8, 0, 1)).toBe(1);
    // raw BR (1,3) → display top-right (3,0)
    expect(get(o8, 3, 0)).toBe(9);
  });

  it("drawOrientedImage applies rotate/translate for 3, 6, and 8", () => {
    for (const orientation of [1, 3, 6, 8]) {
      const calls: string[] = [];
      const ctx = {
        translate: (...args: number[]) => calls.push(`translate:${args.join(",")}`),
        rotate: (r: number) => calls.push(`rotate:${r}`),
        scale: (...args: number[]) => calls.push(`scale:${args.join(",")}`),
        drawImage: () => calls.push("drawImage"),
      } as unknown as CanvasRenderingContext2D;
      drawOrientedImage(ctx, {} as CanvasImageSource, 100, 200, orientation);
      expect(calls).toContain("drawImage");
      if (orientation === 1) {
        expect(calls.some((c) => c.startsWith("rotate:"))).toBe(false);
      } else {
        expect(calls.some((c) => c.startsWith("rotate:"))).toBe(true);
      }
    }
  });

  it("source uses createImageBitmap default (EXIF baked) and HTMLImageElement none+manual fallback", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/receipts/client-image.ts"), "utf8");
    expect(source).toContain("createImageBitmap(file)");
    expect(source).toContain('createImageBitmap(img, { imageOrientation: "none" })');
    expect(source).toContain('img.style.imageOrientation = "none"');
    expect(source).toContain("appliedExif");
    expect(source).toContain("drawOrientedImage");
  });

  it("inspection media queue uses processReceiptImage (shared pipeline)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(source).toContain("processReceiptImage");
    expect(source).toContain("cancelAndDiscardMediaUpload");
  });
});

describe("processReceiptImage with mocked bitmap (browser already applied EXIF)", () => {
  const SENSOR_W = 40;
  const SENSOR_H = 20;

  beforeEach(() => {
    // Simulate createImageBitmap from-image: returns upright dimensions already.
    // For ori 6/8 the upright size would be swapped; we return SENSOR dims as "already fixed".
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (_src: unknown, opts?: { imageOrientation?: string }) => {
        // Primary path: no options (browser default from-image).
        expect(opts).toBeUndefined();
        return {
          width: SENSOR_W,
          height: SENSOR_H,
          close: () => undefined,
        };
      }),
    );

    class FakeCanvas {
      width = 0;
      height = 0;
      getContext() {
        return {
          translate: () => undefined,
          rotate: () => undefined,
          scale: () => undefined,
          drawImage: () => undefined,
        };
      }
      toBlob(cb: (blob: Blob | null) => void) {
        const payload = new Uint8Array([
          this.width & 0xff,
          this.height & 0xff,
          0xff,
          0xd8,
          0xff,
          0xd9,
        ]);
        cb(new Blob([payload], { type: "image/jpeg" }));
      }
    }
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "canvas") return new FakeCanvas() as unknown as HTMLCanvasElement;
      return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    { orientation: 1, expectW: 40, expectH: 20 },
    { orientation: 3, expectW: 40, expectH: 20 },
    // Bitmap path already upright — must NOT swap again (would double-rotate).
    { orientation: 6, expectW: 40, expectH: 20 },
    { orientation: 8, expectW: 40, expectH: 20 },
  ] as const)(
    "orientation $orientation → $expectW×$expectH (bitmap EXIF already applied)",
    async ({ orientation, expectW, expectH }) => {
      const file = new File(
        [new Uint8Array(jpegWithOrientation(orientation))],
        `ori-${orientation}.jpg`,
        {
          type: "image/jpeg",
        },
      );
      const result = await processReceiptImage(file, { maxEdge: 1000, quality: 0.8 });
      expect(result.width).toBe(expectW);
      expect(result.height).toBe(expectH);
      expect(result.mimeType).toBe("image/jpeg");
      expect(createImageBitmap).toHaveBeenCalledWith(file);
    },
  );
});

describe("processReceiptImage HTMLImageElement fallback (manual EXIF)", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", undefined);

    class FakeImage {
      width = 20;
      height = 40;
      naturalWidth = 20;
      naturalHeight = 40;
      style: { imageOrientation?: string } = {};
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage as unknown as typeof Image);

    class FakeCanvas {
      width = 0;
      height = 0;
      getContext() {
        return {
          translate: () => undefined,
          rotate: () => undefined,
          scale: () => undefined,
          drawImage: () => undefined,
        };
      }
      toBlob(cb: (blob: Blob | null) => void) {
        cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }));
      }
    }
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "canvas") return new FakeCanvas() as unknown as HTMLCanvasElement;
      return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    { orientation: 1, expectW: 20, expectH: 40 },
    { orientation: 3, expectW: 20, expectH: 40 },
    { orientation: 6, expectW: 40, expectH: 20 },
    { orientation: 8, expectW: 40, expectH: 20 },
  ] as const)(
    "fallback orientation $orientation → $expectW×$expectH",
    async ({ orientation, expectW, expectH }) => {
      const file = new File(
        [new Uint8Array(jpegWithOrientation(orientation))],
        `fb-${orientation}.jpg`,
        { type: "image/jpeg" },
      );
      const result = await processReceiptImage(file, { maxEdge: 1000, quality: 0.8 });
      expect(result.width).toBe(expectW);
      expect(result.height).toBe(expectH);
    },
  );
});
