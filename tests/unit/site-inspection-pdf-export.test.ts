/**
 * Site inspection PDF export — structure + resize (no Chromium).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  resetSiteInspectionAiMemoryForTests,
  upsertItemSummary,
  updateMediaTranscript,
} from "@/lib/inspections/ai/store";
import {
  createSiteInspection,
  createTemplateFromSeed,
  DETACHED_ADU_SEED,
  completeSiteInspectionMedia,
  prepareSiteInspectionMedia,
  putMemoryMediaBytes,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  getSiteInspection,
  upsertSiteInspectionResponse,
} from "@/lib/inspections";
import {
  buildSiteInspectionPdf,
  countPdfEmbeddableMedia,
  PDF_INLINE_MEDIA_LIMIT,
} from "@/lib/inspections/ai/export-pdf";

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  resetSiteInspectionAiMemoryForTests();
  setSiteInspectionProfileNameForTests("user-1", "Field Tech");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function tinyJpeg(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 80, b: 120 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("site inspection PDF export", () => {
  it("exports a readable PDF without guide notes for a full inspection", async () => {
    const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
    const inspection = await createSiteInspection({
      projectName: "Liniger ADU",
      address: "25 N Avalon",
      templateId: template.id,
      createdBy: "user-1",
      assignedTo: "user-1",
    });
    const item = inspection.snapshot.standaloneItems[0]!;
    const jpeg = await tinyJpeg();

    const photoClient = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const preparedPhoto = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: item.id,
      clientMediaId: photoClient,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: jpeg.byteLength,
      actorId: "user-1",
    });
    putMemoryMediaBytes({
      storagePath: preparedPhoto.upload.path,
      bytes: jpeg,
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });
    await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId: photoClient,
      snapshotItemId: item.id,
      mediaType: "photo",
      mimeType: "image/jpeg",
      storagePath: preparedPhoto.upload.path,
      byteSize: jpeg.byteLength,
      actorId: "user-1",
    });

    const videoClient = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const preparedVideo = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: item.id,
      clientMediaId: videoClient,
      mediaType: "video",
      mimeType: "video/mp4",
      byteSize: 500,
      actorId: "user-1",
    });
    putMemoryMediaBytes({
      storagePath: preparedVideo.upload.path,
      bytes: Buffer.alloc(500, 2),
      mimeType: "video/mp4",
      uploadedBy: "user-1",
    });
    const posterPath = preparedVideo.upload.path.replace(/\.[^.]+$/, ".poster.jpg");
    putMemoryMediaBytes({
      storagePath: posterPath,
      bytes: jpeg,
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });
    await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId: videoClient,
      snapshotItemId: item.id,
      mediaType: "video",
      mimeType: "video/mp4",
      storagePath: preparedVideo.upload.path,
      byteSize: 500,
      actorId: "user-1",
      posterStoragePath: posterPath,
    });

    const videoId = (await getSiteInspection(inspection.id)).media.find(
      (m) => m.mediaType === "video",
    )!.id;
    await updateMediaTranscript(videoId, {
      transcript_status: "complete",
      transcript_text: "Sewer lateral looks about eight feet deep.",
      transcript_segments: [
        { start: 0, end: 3, text: "Sewer lateral looks about eight feet deep." },
      ],
    });

    await upsertSiteInspectionResponse({
      inspectionId: inspection.id,
      snapshotItemId: item.id,
      notes: "Panel clearance looks tight on the east side.",
      isComplete: true,
      actorId: "user-1",
    });
    await upsertItemSummary({
      inspectionId: inspection.id,
      snapshotItemId: item.id,
      summaryText: "Inspector noted sewer depth and east-side clearance.",
      contentFingerprint: "fp",
      sourceNotes: "Panel clearance looks tight on the east side.",
      sourceVideoIds: [videoId],
      status: "complete",
    });

    const detail = await getSiteInspection(inspection.id);
    const result = await buildSiteInspectionPdf(detail);

    expect(result.bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(result.byteSize).toBeGreaterThan(1000);
    expect(result.embeddedImageCount).toBeGreaterThanOrEqual(1);

    // Compressed PDF streams may not contain literal UI strings; verify structure via size
    // and that guide-note text was never passed into the document builder (omitted by design).
    expect(item.guideNotes.trim().length).toBeGreaterThan(0);
    const source = await import("@/lib/inspections/ai/export-pdf").then(async () => {
      const fs = await import("node:fs");
      return fs.readFileSync("src/lib/inspections/ai/export-pdf.tsx", "utf8");
    });
    expect(source).not.toMatch(/guideNotes/);
    expect(source).toMatch(/AI-generated summary/);
  });

  it("still produces a PDF with no media and incomplete items", async () => {
    const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
    const inspection = await createSiteInspection({
      projectName: "Empty Visit",
      address: "1 Main St",
      templateId: template.id,
      createdBy: "user-1",
    });
    const detail = await getSiteInspection(inspection.id);
    expect(countPdfEmbeddableMedia(detail)).toBe(0);
    const result = await buildSiteInspectionPdf(detail);
    expect(result.bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(result.embeddedImageCount).toBe(0);
  });

  it("keeps media-heavy output email-sized via resize", async () => {
    const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
    const inspection = await createSiteInspection({
      projectName: "Heavy Media",
      address: "9 Oak",
      templateId: template.id,
      createdBy: "user-1",
    });
    const item = inspection.snapshot.standaloneItems[0]!;
    const jpeg = await tinyJpeg();
    // 12 full-res-ish photos → raw would be large; resized PDF should stay modest.
    for (let i = 0; i < 12; i += 1) {
      const clientMediaId = randomUUID();
      const prepared = await prepareSiteInspectionMedia({
        inspectionId: inspection.id,
        snapshotItemId: item.id,
        clientMediaId,
        mediaType: "photo",
        mimeType: "image/jpeg",
        byteSize: jpeg.byteLength,
        actorId: "user-1",
      });
      putMemoryMediaBytes({
        storagePath: prepared.upload.path,
        bytes: jpeg,
        mimeType: "image/jpeg",
        uploadedBy: "user-1",
      });
      await completeSiteInspectionMedia({
        inspectionId: inspection.id,
        clientMediaId,
        snapshotItemId: item.id,
        mediaType: "photo",
        mimeType: "image/jpeg",
        storagePath: prepared.upload.path,
        byteSize: jpeg.byteLength,
        actorId: "user-1",
      });
    }
    const detail = await getSiteInspection(inspection.id);
    const rawPhotoBytes = 12 * jpeg.byteLength;
    const result = await buildSiteInspectionPdf(detail);
    expect(result.embeddedImageCount).toBe(12);
    // Resized embeds should be well under the sum of source JPEGs.
    expect(result.byteSize).toBeLessThan(rawPhotoBytes);
    expect(result.byteSize).toBeLessThan(8 * 1024 * 1024);
    expect(PDF_INLINE_MEDIA_LIMIT).toBeGreaterThan(12);
    // Solid-color fixtures compress extremely well; still assert a sane upper bound
    // for emailability (real site photos typically land ~2–5 MB for ~50 images).
    expect(result.byteSize).toBeGreaterThan(5_000);
  });

  it("lays out photos with contain (no crop) and a non-colliding footer", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/inspections/ai/export-pdf.tsx"),
      "utf8",
    );
    const photoImgBlock = source.slice(source.indexOf("photoImg:"), source.indexOf("videoBadge:"));
    expect(photoImgBlock).toContain('objectFit: "contain"');
    expect(photoImgBlock).not.toContain('objectFit: "cover"');
    expect(photoImgBlock).not.toContain("maxHeight");
    expect(source).toContain("footerLeft");
    expect(source).toContain("footerCenter");
    expect(source).toContain("footerRight");
    expect(source).toContain("paddingBottom: 72");
    expect(source).not.toContain("bottom: 28, left: 44, fontSize: 7");
  });
});
