import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeInputFiles } from "@/lib/tours/input-files";
import { readPanoramaDimensions } from "@/lib/tours/pixel-size";
import { mapWithConcurrency } from "@/lib/tours/pool";
import { tourSaveLabel, tourSaveState } from "@/lib/tours/save-state";

vi.mock("@/lib/receipts/client-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/receipts/client-image")>(
    "@/lib/receipts/client-image",
  );
  return {
    ...actual,
    loadOrientedImage: vi.fn(() => {
      throw new Error("full-resolution decode");
    }),
    renderScaledJpeg: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
  };
});

import { derivePanoramaImages } from "@/lib/tours/client-panorama";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function jpeg(width: number, height: number, orientation?: number, name = "room.jpg"): File {
  const chunks: number[] = [0xff, 0xd8];
  if (orientation) {
    chunks.push(
      0xff,
      0xe1,
      0x00,
      0x1e,
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00,
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x12,
      0x01,
      0x03,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      orientation,
      0x00,
      0x00,
      0x00,
    );
  }
  chunks.push(
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  );
  return new File([new Uint8Array(chunks)], name, { type: "image/jpeg" });
}

function png(width: number, height: number): File {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "room.png", { type: "image/png" });
}

describe("panorama file selection", () => {
  it("copies a live FileList before the input is cleared", () => {
    const file = new File(["bytes"], "room.jpg", { type: "image/jpeg" });
    const store = [file];
    const list = {
      get length() {
        return store.length;
      },
      *[Symbol.iterator]() {
        yield* store;
      },
    } as FileList;
    const selected = takeInputFiles(list);
    store.length = 0;
    expect(selected.map((item) => item.name)).toEqual(["room.jpg"]);
    expect(list.length).toBe(0);
  });
});

describe("panorama header size", () => {
  it("reads a 16384×8192 JPEG from the header and swaps EXIF orientation", async () => {
    await expect(readPanoramaDimensions(jpeg(16384, 8192))).resolves.toEqual({
      width: 16384,
      height: 8192,
    });
    await expect(readPanoramaDimensions(jpeg(8192, 16384, 6))).resolves.toEqual({
      width: 16384,
      height: 8192,
    });
    await expect(readPanoramaDimensions(png(8000, 4000))).resolves.toEqual({
      width: 8000,
      height: 4000,
    });
  });
});

describe("panorama derivatives", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resizes with createImageBitmap and never decodes the full panorama", async () => {
    const calls: Array<{ resizeWidth?: number; resizeHeight?: number }> = [];
    const file = jpeg(16384, 8192);
    const sizeBefore = file.size;
    vi.stubGlobal(
      "createImageBitmap",
      async (_file: Blob, options: { resizeWidth?: number; resizeHeight?: number }) => {
        calls.push(options);
        return {
          width: options.resizeWidth,
          height: options.resizeHeight,
          close: () => undefined,
        };
      },
    );

    const derived = await derivePanoramaImages(file);

    expect(file.size).toBe(sizeBefore);
    expect(derived.width).toBe(16384);
    expect(derived.height).toBe(8192);
    expect(derived.compat).toBeInstanceOf(Blob);
    expect(calls.map((call) => [call.resizeWidth, call.resizeHeight])).toEqual([
      [800, 400],
      [4096, 2048],
    ]);
    expect(source("src/lib/tours/client-panorama.ts")).not.toContain("loadOrientedImage");
    expect(source("src/lib/receipts/client-image.ts")).not.toContain("resizeWidth");
    expect(source("src/lib/inspections/media-queue.ts")).toContain("processReceiptImage");
    expect(source("src/lib/tours/upload-one.ts")).toContain("file: input.file");
  });

  it("reports a decode failure for one file and still processes the next", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      async (file: File, options: { resizeWidth: number; resizeHeight: number }) => {
        if (file.name === "bad.jpg") throw new Error("The source image could not be decoded.");
        return {
          width: options.resizeWidth,
          height: options.resizeHeight,
          close: () => undefined,
        };
      },
    );
    const bad = jpeg(8000, 4000, undefined, "bad.jpg");
    const good = jpeg(8000, 4000, undefined, "good.jpg");

    const settled = await mapWithConcurrency([bad, good], 2, async (file) => {
      try {
        const derived = await derivePanoramaImages(file);
        return { name: file.name, error: null as string | null, width: derived.width };
      } catch (error) {
        return {
          name: file.name,
          error: error instanceof Error ? error.message : "Upload failed.",
          width: 0,
        };
      }
    });

    const values = settled.map((result) => (result.status === "fulfilled" ? result.value : null));
    expect(values[0]?.error).toMatch(/bad.jpg|Could not process this panorama/);
    expect(values[0]?.error).toMatch(/could not be decoded/i);
    expect(values[1]).toMatchObject({ name: "good.jpg", error: null, width: 8000 });
  });

  it("fails loudly when the browser returns the full-resolution bitmap", async () => {
    const closed = vi.fn();
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 16384,
      height: 8192,
      close: closed,
    }));
    await expect(derivePanoramaImages(jpeg(16384, 8192))).rejects.toThrow(/full panorama/);
    expect(closed).toHaveBeenCalled();
  });
});

describe("tour save indicator", () => {
  it("matches the inspection saved and saving labels", () => {
    expect(tourSaveLabel("saved")).toBe("All changes saved");
    expect(tourSaveLabel("saving")).toBe("Saving…");
    expect(tourSaveState({ inFlight: 1, failed: false, dirty: true })).toBe("saving");
    expect(tourSaveState({ inFlight: 0, failed: true, dirty: false })).toBe("error");
    expect(tourSaveState({ inFlight: 0, failed: false, dirty: true })).toBe("pending");
    expect(tourSaveState({ inFlight: 0, failed: false, dirty: false })).toBe("saved");
    expect(source("src/components/tours/tour-editor.tsx")).toContain("tourSaveLabel(saveState)");
  });
});
