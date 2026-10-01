import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { equirectangularWarning } from "@/lib/tours/aspect";
import { TOUR_PANORAMA_MAX_BYTES, TOUR_UPLOAD_CONCURRENCY } from "@/lib/tours/constants";
import { sniffPanoramaMime } from "@/lib/tours/client-panorama";
import {
  collectSceneStoragePaths,
  collectTourStoragePaths,
  needsCompatPanorama,
  tourSceneObjectPaths,
} from "@/lib/tours/paths";
import { mapWithConcurrency } from "@/lib/tours/pool";

const { uploadToSignedUrl } = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl }),
    },
  }),
}));

import { originalPanoramaBody, uploadOriginalPanorama } from "@/lib/tours/upload-original";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("tour panorama rules", () => {
  it("warns when the aspect ratio is outside 2:1 ± 3% and still allows a close match", () => {
    expect(equirectangularWarning(8192, 4096)).toBeNull();
    expect(equirectangularWarning(8000, 4000)).toBeNull();
    expect(equirectangularWarning(8192, 4000)).toBeNull();
    expect(equirectangularWarning(7000, 4000)).toMatch(/not a 2:1 panorama/);
  });

  it("asks for a compatibility JPEG only when the original is wider than 4096", () => {
    expect(needsCompatPanorama(4096)).toBe(false);
    expect(needsCompatPanorama(4097)).toBe(true);
  });

  it("collects every stored object, skipping missing derived files", () => {
    const paths = tourSceneObjectPaths("tour", "scene", { compat: true, extension: "jpg" });
    expect(paths).toEqual({
      storagePath: "tour/scene.jpg",
      compatPath: "tour/scene-compat.jpg",
      thumbnailPath: "tour/scene-thumb.jpg",
    });
    expect(
      tourSceneObjectPaths("tour", "scene", { compat: false, extension: "png" }).storagePath,
    ).toBe("tour/scene.png");
    expect(
      collectSceneStoragePaths({
        storagePath: "tour/scene.jpg",
        compatPath: null,
        thumbnailPath: "tour/scene-thumb.jpg",
      }),
    ).toEqual(["tour/scene.jpg", "tour/scene-thumb.jpg"]);
    expect(
      collectTourStoragePaths([
        { storagePath: "a.jpg", compatPath: null, thumbnailPath: "a-thumb.jpg" },
        { storagePath: "a.jpg", compatPath: "a-compat.jpg", thumbnailPath: null },
      ]),
    ).toEqual(["a.jpg", "a-thumb.jpg", "a-compat.jpg"]);
  });

  it("accepts JPEG and PNG magic bytes only", () => {
    expect(sniffPanoramaMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffPanoramaMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffPanoramaMime(Uint8Array.from([0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  it("uploads the original File object and never asks supabase-js for progress", async () => {
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "pano.jpg", {
      type: "image/jpeg",
    });
    expect(originalPanoramaBody(file)).toBe(file);
    await uploadOriginalPanorama({
      file,
      path: "tour/scene.jpg",
      token: "token",
      contentType: "image/jpeg",
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("tour/scene.jpg", "token", file, {
      contentType: "image/jpeg",
    });
    const uploadSource =
      source("src/lib/tours/upload-original.ts") + source("src/lib/tours/upload-one.ts");
    expect(uploadSource).not.toMatch(/onUploadProgress/);
    expect(source("src/lib/tours/upload-one.ts")).toMatch(/file: input\.file/);
    expect(source("src/lib/tours/client-panorama.ts")).not.toMatch(/uploadToSignedUrl/);
  });

  it("keeps at most three uploads in flight and finishes the rest after one failure", async () => {
    expect(TOUR_UPLOAD_CONCURRENCY).toBe(3);
    let inFlight = 0;
    let max = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 3, async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
    });
    expect(max).toBe(3);

    const settled = await mapWithConcurrency([1, 2, 3], 3, async (value) => {
      if (value === 2) throw new Error("one file failed");
      return value;
    });
    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("tour server surface", () => {
  it("gates pages to any app-access user", () => {
    for (const page of ["src/app/tours/page.tsx", "src/app/tours/[tourId]/page.tsx"]) {
      const text = source(page);
      expect(text).toMatch(/requireActiveUser/);
      expect(text).not.toMatch(/requireAdmin/);
    }
  });

  it("updates named columns and deletes storage objects before the row", () => {
    const actions = source("src/lib/tours/actions.ts");
    const store = source("src/lib/tours/store.ts");
    expect(actions).toMatch(/requireActiveUser/);
    expect(store).toMatch(/\.update\(\{/);
    expect(`${actions}\n${store}`).not.toMatch(/\.upsert\(/);
    for (const name of ["deleteTour", "deleteScene"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const storageAt = body.indexOf("removeTourPanoramaObjects");
      const rowAt = body.indexOf(name === "deleteTour" ? "deleteTourRow" : "deleteSceneRow");
      expect(storageAt).toBeGreaterThan(-1);
      expect(rowAt).toBeGreaterThan(storageAt);
    }
  });

  it("keeps the panorama bucket private at 200MB", () => {
    const sql = source("supabase/migrations/060_virtual_tours.sql");
    expect(sql).toMatch(/209715200/);
    expect(sql).toMatch(/public = false/);
    expect(TOUR_PANORAMA_MAX_BYTES).toBe(209715200);
    expect(sql.replaceAll("(select auth.uid())", "")).not.toMatch(/auth\.uid\(\)/);
  });
});
