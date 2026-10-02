import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { embedChrome } from "@/lib/tours/embed-chrome";
import {
  TOUR_IMAGE_PROXY_MAX_AGE_SECONDS,
  TOUR_PAGE_REVALIDATE_SECONDS,
  TOUR_VIEWER_SIGNED_URL_SECONDS,
} from "@/lib/tours/constants";
import {
  sceneFileForVariant,
  tourImageCacheControl,
  tourImageDecision,
} from "@/lib/tours/image-access";
import { securityHeaderRules } from "@/lib/http/security-headers";
import { mapViewerTour } from "@/lib/tours/map-tour";
import { panoramaExtension } from "@/lib/tours/paths";
import { isAnonymousTourPath } from "@/lib/tours/public-paths";
import { insertWithUniqueSlug } from "@/lib/tours/slug";
import {
  buildVirtualTourNodes,
  placedHotspotAngles,
  resolvePanoramaVariant,
} from "@/lib/tours/viewer-model";
import type { ViewerScene } from "@/lib/tours/viewer-model";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function scene(partial: Partial<ViewerScene> & Pick<ViewerScene, "id">): ViewerScene {
  return {
    name: partial.id,
    width: 8000,
    height: 4000,
    hasCompat: true,
    hasInitialView: false,
    initialYaw: 0,
    initialPitch: 0,
    thumbUrl: null,
    hotspots: [],
    ...partial,
  };
}

describe("tour image proxy", () => {
  it("allows a public tour without a session and hides private tours from anonymous callers", () => {
    expect(
      tourImageDecision({ found: true, slugMatches: true, isPublic: true, isAppUser: false }),
    ).toBe("allow");
    expect(
      tourImageDecision({ found: true, slugMatches: true, isPublic: false, isAppUser: false }),
    ).toBe("not-found");
    expect(
      tourImageDecision({ found: true, slugMatches: true, isPublic: false, isAppUser: true }),
    ).toBe("allow");
    expect(
      tourImageDecision({ found: true, slugMatches: false, isPublic: true, isAppUser: true }),
    ).toBe("not-found");
  });

  it("keeps the redirect cache shorter than the 12 hour signature", () => {
    expect(TOUR_PAGE_REVALIDATE_SECONDS).toBe(TOUR_IMAGE_PROXY_MAX_AGE_SECONDS);
    expect(TOUR_IMAGE_PROXY_MAX_AGE_SECONDS).toBeLessThan(TOUR_VIEWER_SIGNED_URL_SECONDS);
    expect(TOUR_VIEWER_SIGNED_URL_SECONDS - TOUR_IMAGE_PROXY_MAX_AGE_SECONDS).toBe(39_600);
    expect(tourImageCacheControl(true)).toBe("public, max-age=3600, s-maxage=3600");
    expect(tourImageCacheControl(false)).toBe("private, max-age=3600");
    for (const file of ["src/app/tour/[slug]/page.tsx", "src/app/embed/[slug]/page.tsx"]) {
      expect(source(file)).toContain(`export const revalidate = ${TOUR_PAGE_REVALIDATE_SECONDS}`);
    }
  });
});

describe("tour viewer nodes", () => {
  it("chooses the panorama URL before any viewer call and skips dangling links", () => {
    const wide = scene({
      id: "wide",
      hotspots: [
        {
          id: "ok",
          type: "link",
          yaw: 1.2,
          pitch: -0.4,
          label: null,
          content: null,
          targetSceneId: "next",
          styleShape: "arrow",
          styleColor: "#FFFFFF",
          styleSize: 48,
          styleRotation: 0,
          stylePlacement: "billboard",
        },
        {
          id: "dangling",
          type: "link",
          yaw: 0.2,
          pitch: 0.1,
          label: null,
          content: null,
          targetSceneId: "missing",
          styleShape: "arrow",
          styleColor: "#FFFFFF",
          styleSize: 48,
          styleRotation: 0,
          stylePlacement: "billboard",
        },
      ],
    });
    const nodes = buildVirtualTourNodes({
      slug: "abc",
      scenes: [wide, scene({ id: "next", width: 2000, hasCompat: false })],
      maxTextureSize: 4096,
    });
    expect(nodes[0]?.panorama).toBe("/api/tours/abc/image/wide?variant=compat");
    expect(nodes[1]?.panorama).toBe("/api/tours/abc/image/next?variant=full");
    expect(nodes[0]?.links).toEqual([
      expect.objectContaining({
        nodeId: "next",
        position: { yaw: 1.2, pitch: -0.4 },
      }),
    ]);
    const editing = buildVirtualTourNodes({
      slug: "abc",
      scenes: [wide, scene({ id: "next", width: 2000, hasCompat: false })],
      maxTextureSize: 4096,
      includeLinks: false,
    });
    expect(editing[0]?.links).toEqual([]);
    expect(resolvePanoramaVariant(4096, true, 4096)).toBe("full");
    expect(resolvePanoramaVariant(8000, false, 4096)).toBe("full");
    expect(resolvePanoramaVariant(8192, true, 16384)).toBe("full");
    const authoring = buildVirtualTourNodes({
      slug: "abc",
      scenes: [wide],
      maxTextureSize: 16384,
      includeLinks: false,
      resolution: "edit",
    });
    expect(authoring[0]?.panorama).toBe("/api/tours/abc/image/wide?variant=edit");
    expect(authoring[0]?.links).toEqual([]);
    const published = buildVirtualTourNodes({
      slug: "abc",
      scenes: [wide, scene({ id: "next", width: 2000, hasCompat: false })],
      maxTextureSize: 16384,
    });
    expect(published[0]?.panorama).toBe("/api/tours/abc/image/wide?variant=full");
    expect(published[1]?.panorama).toBe("/api/tours/abc/image/next?variant=full");
    expect(published[0]?.links[0]?.position).toEqual({ yaw: 1.2, pitch: -0.4 });
    expect(
      sceneFileForVariant("edit", {
        storagePath: "tour/scene.jpg",
        compatPath: "tour/scene-compat.jpg",
        thumbnailPath: "tour/scene-thumb.jpg",
      }),
    ).toBe("tour/scene-compat.jpg");
    expect(
      sceneFileForVariant("edit", {
        storagePath: "tour/scene.jpg",
        compatPath: null,
        thumbnailPath: "tour/scene-thumb.jpg",
      }),
    ).toBe("tour/scene.jpg");
    expect(
      sceneFileForVariant("full", {
        storagePath: "tour/scene.jpg",
        compatPath: "tour/scene-compat.jpg",
        thumbnailPath: null,
      }),
    ).toBe("tour/scene.jpg");
  });

  it("stores the same yaw and pitch for a reduced panorama and a full one", () => {
    const click = { yaw: 1.25, pitch: -0.4 };
    expect(placedHotspotAngles(click, { width: 8192, height: 4096 })).toEqual(
      placedHotspotAngles(click, { width: 4096, height: 2048 }),
    );
    expect(placedHotspotAngles(click, { width: 5824, height: 2880 })).toEqual(click);
    const viewer = source("src/components/tours/panorama-viewer.tsx");
    expect(viewer).toContain("yaw: event.data.yaw");
    expect(viewer).toContain("pitch: event.data.pitch");
    expect(source("src/components/tours/tour-editor.tsx")).toContain('resolution="edit"');
    expect(source("src/app/tours/[tourId]/preview/page.tsx")).not.toContain('resolution="edit"');
    expect(source("src/app/tour/[slug]/page.tsx")).not.toContain('resolution="edit"');
    expect(source("src/app/embed/[slug]/page.tsx")).not.toContain('resolution="edit"');
  });

  it("does not call setCurrentNode until the first panorama has loaded", () => {
    const viewer = source("src/components/tours/panorama-viewer.tsx");
    expect(viewer).toMatch(/tour\.setNodes\(/);
    expect(viewer).toMatch(/if \(!tour \|\| !bootedRef\.current \|\| loadingRef\.current\) return/);
    expect(viewer).toMatch(/current === currentSceneId/);
    expect(source("src/components/tours/panorama-viewer-client.tsx")).toMatch(/ssr:\s*false/);
    expect(source("src/components/tours/tour-stage.tsx")).not.toMatch(/photo-sphere-viewer/);
  });
});

describe("tour routes", () => {
  it("leaves /tours authenticated and opens the public tour, embed, and image proxy", () => {
    expect(isAnonymousTourPath("/tours")).toBe(false);
    expect(isAnonymousTourPath("/tours/abc")).toBe(false);
    expect(isAnonymousTourPath("/tour/abc")).toBe(true);
    expect(isAnonymousTourPath("/embed/abc")).toBe(true);
    expect(isAnonymousTourPath("/api/tours/abc/image/id")).toBe(true);
  });

  it("hides embed chrome only for an explicit 0", () => {
    expect(embedChrome({ title: "0", thumbs: "nope" })).toEqual({
      showTitle: false,
      showThumbs: true,
      showShare: true,
      showFullscreen: true,
    });
  });

  it("lets /embed be framed and keeps X-Frame-Options off that path", () => {
    const rules = securityHeaderRules();
    const embed = rules.find((rule) => rule.source.startsWith("/embed"));
    const rest = rules.find((rule) => rule.source !== embed?.source);
    expect(embed?.headers.some((header) => header.key === "X-Frame-Options")).toBe(false);
    expect(
      embed?.headers.find((header) => header.key === "Content-Security-Policy")?.value,
    ).toMatch(/frame-ancestors \*/);
    expect(rest?.headers.find((header) => header.key === "X-Frame-Options")?.value).toBe(
      "SAMEORIGIN",
    );
    expect(rest?.headers.find((header) => header.key === "Content-Security-Policy")?.value).toMatch(
      /frame-ancestors 'self'/,
    );
  });

  it("stores png bytes under a png path and retries a slug collision", async () => {
    expect(panoramaExtension("image/png")).toBe("png");
    expect(panoramaExtension("image/jpeg")).toBe("jpg");
    const slugs: string[] = [];
    let tries = 0;
    const created = await insertWithUniqueSlug(async (slug) => {
      tries += 1;
      slugs.push(slug);
      if (tries < 3) return { ok: false, code: "23505", message: "duplicate" };
      return { ok: true, value: slug };
    });
    expect(created.error).toBeNull();
    expect(created.value).toBe(slugs[2]);
    expect(new Set(slugs).size).toBe(3);
  });

  it("keeps a legacy jpg path when mapping a stored scene", () => {
    const tour = mapViewerTour({
      id: "tour",
      title: "Kitchen",
      description: null,
      slug: "legacy",
      is_public: true,
      cover_scene_id: "scene",
      scenes: [
        {
          id: "scene",
          name: "Scene",
          position: 0,
          width: 100,
          height: 50,
          compat_path: null,
          thumbnail_path: "tour/scene-thumb.jpg",
          initial_yaw: 0,
          initial_pitch: 0,
          has_initial_view: false,
          hotspots: [],
        },
      ],
    });
    expect(tour.scenes[0]?.thumbUrl).toBe("/api/tours/legacy/image/scene?variant=thumb");
    expect(tour.scenes[0]?.hasCompat).toBe(false);
  });
});
