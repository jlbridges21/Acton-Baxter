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
import { embedIframeSnippet, publicTourUrl } from "@/lib/tours/embed-snippet";
import { VIEWER_TOUR_SELECT } from "@/lib/tours/map-tour";
import { mapWithConcurrency } from "@/lib/tours/pool";
import { formatUploadBytes, putSignedObject } from "@/lib/tours/signed-put";
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

  it("uploads the original File with XHR byte progress and aborts that request", async () => {
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "pano.jpg", {
      type: "image/jpeg",
    });
    expect(originalPanoramaBody(file)).toBe(file);
    const loaded = Math.round(1.4 * 1024 * 1024);
    const total = Math.round(2.7 * 1024 * 1024);
    const progress: Array<[number, number]> = [];
    const xhr = installFakeXhr({
      onProgress: () => ({ loaded, total }),
    });
    await uploadOriginalPanorama({
      file,
      signedUrl: "https://example.test/object/upload/sign/tour/scene.jpg?token=token",
      contentType: "image/jpeg",
      onProgress: (nextLoaded, nextTotal) => progress.push([nextLoaded, nextTotal]),
    });
    expect(xhr.method).toBe("PUT");
    expect(xhr.sent).toBe(file);
    expect(xhr.headers["Content-Type"]).toBe("image/jpeg");
    expect(xhr.headers["x-upsert"]).toBe("true");
    expect(progress).toEqual([[loaded, total]]);
    expect(formatUploadBytes(loaded, total)).toBe("1.4 MB / 2.7 MB · 52%");

    const controller = new AbortController();
    const hanging = installFakeXhr({ hold: true });
    const pending = putSignedObject({
      signedUrl: "https://example.test/upload",
      body: file,
      contentType: "image/jpeg",
      signal: controller.signal,
    });
    controller.abort();
    expect(hanging.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const uploadSource =
      source("src/lib/tours/upload-original.ts") +
      source("src/lib/tours/upload-one.ts") +
      source("src/lib/tours/signed-put.ts");
    expect(uploadSource).not.toMatch(/onUploadProgress/);
    expect(uploadSource).not.toMatch(/uploadToSignedUrl/);
    expect(source("src/lib/tours/signed-put.ts")).toMatch(/xhr\.upload\.onprogress/);
    expect(source("src/lib/tours/signed-put.ts")).toMatch(/xhr\.abort\(\)/);
    expect(source("src/lib/tours/upload-one.ts")).toMatch(/file: input\.file/);
    expect(source("src/lib/tours/upload-one.ts")).toMatch(/discardSceneUpload/);
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

  it("embeds hotspots through the scene relationship and loads the editor from that query", () => {
    expect(VIEWER_TOUR_SELECT).toMatch(/scenes!scenes_tour_id_fkey/);
    expect(VIEWER_TOUR_SELECT).toMatch(/hotspots!hotspots_scene_id_fkey/);
    expect(VIEWER_TOUR_SELECT).not.toMatch(/hotspots \(\s*id/);
    const editorPage = source("src/app/tours/[tourId]/page.tsx");
    expect(editorPage).toMatch(/getViewerTour/);
    expect(source("src/app/tours/[tourId]/preview/page.tsx")).toMatch(
      /params: Promise<\{ tourId: string \}>/,
    );
    expect(source("src/components/tours/tour-editor.tsx")).toMatch(
      /\/tours\/\$\{tour\.id\}\/preview/,
    );
  });

  it("keeps the editor on the existing viewer and one set of guards", () => {
    const editor = source("src/components/tours/tour-editor.tsx");
    const viewer = source("src/components/tours/panorama-viewer.tsx");
    expect(editor).toMatch(/<TourStage/);
    expect(editor).toMatch(/layout="frame"/);
    expect(editor).not.toMatch(/from "@\/components\/tours\/panorama-viewer"/);
    expect(viewer).toMatch(/bootedRef/);
    expect(viewer).toMatch(/current === currentSceneId/);
    expect(viewer).toMatch(/tour\.setNodes\(/);
    expect(source("src/components/tours/scene-list.tsx")).toMatch(/sortableKeyboardCoordinates/);
  });
});

describe("tour share snippet", () => {
  it("hides chrome with =0 and leaves the public link off a private tour", () => {
    const origin = "https://acton.example";
    expect(publicTourUrl(origin, "oak-lane")).toBe("https://acton.example/tour/oak-lane");
    const full = embedIframeSnippet({
      origin,
      slug: "oak-lane",
      showTitle: true,
      showThumbs: true,
      showShare: true,
      showFullscreen: true,
    });
    expect(full).toContain('src="https://acton.example/embed/oak-lane"');
    expect(full).toContain('width="800"');
    expect(full).toContain('height="480"');
    expect(full).not.toMatch(/[?&](title|thumbs|share|fs)=/);
    const quiet = embedIframeSnippet({
      origin,
      slug: "oak-lane",
      showTitle: false,
      showThumbs: false,
      showShare: false,
      showFullscreen: false,
    });
    expect(quiet).toContain("title=0");
    expect(quiet).toContain("thumbs=0");
    expect(quiet).toContain("share=0");
    expect(quiet).toContain("fs=0");
    const dialog = source("src/components/tours/share-dialog.tsx");
    expect(dialog).toMatch(/This tour is private/);
    expect(dialog).toMatch(/Make public/);
  });
});

type FakeXhr = {
  method: string;
  url: string;
  headers: Record<string, string>;
  sent: unknown;
  aborted: boolean;
};

function installFakeXhr(options?: {
  hold?: boolean;
  onProgress?: () => { loaded: number; total: number };
}): FakeXhr {
  const record: FakeXhr = { method: "", url: "", headers: {}, sent: null, aborted: false };
  class Xhr {
    status = 200;
    responseText = "";
    upload = {
      onprogress: null as
        ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(method: string, url: string) {
      record.method = method;
      record.url = url;
    }
    setRequestHeader(name: string, value: string) {
      record.headers[name] = value;
    }
    send(body: unknown) {
      record.sent = body;
      const progress = options?.onProgress?.();
      if (progress) {
        this.upload.onprogress?.({ lengthComputable: true, ...progress });
      }
      if (!options?.hold) this.onload?.();
    }
    abort() {
      record.aborted = true;
      this.onabort?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", Xhr);
  return record;
}
