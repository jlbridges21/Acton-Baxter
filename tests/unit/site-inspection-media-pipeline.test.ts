/**
 * Site inspection media pipeline — direct-to-storage, queue limits, export, PWA.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  MEDIA_UPLOAD_CONCURRENCY,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_SECONDS,
  VIDEO_WARN_MESSAGE,
  ZIP_FULL_EXPORT_MAX_BYTES,
  DETACHED_ADU_SEED,
  attachSiteInspectionPhoto,
  buildMediaExportFilename,
  completeSiteInspectionMedia,
  createSiteInspection,
  createTemplateFromSeed,
  listSiteInspections,
  prepareSiteInspectionMedia,
  putMemoryMediaBytes,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  updateSiteInspectionMediaStatus,
  uploadSiteInspectionPhoto,
} from "@/lib/inspections";

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  setSiteInspectionProfileNameForTests("user-1", "Field Tech");
});

async function seededInspection() {
  const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
  return createSiteInspection({
    projectName: "Liniger",
    address: "25 N Avalon",
    templateId: template.id,
    createdBy: "user-1",
  });
}

describe("migration 048 media pipeline", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/048_site_inspection_media_pipeline.sql"),
    "utf8",
  );

  it("adds client_media_id, upload_progress, and authenticated storage write policies", () => {
    expect(migration).toContain("client_media_id");
    expect(migration).toContain("upload_progress");
    expect(migration).toContain("Users can upload own site inspection media");
    expect(migration).toContain("site-inspection-media");
  });
});

describe("media limits + export naming", () => {
  it("documents video caps and zip guard", () => {
    expect(VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(VIDEO_MAX_DURATION_SECONDS).toBe(120);
    expect(VIDEO_WARN_MESSAGE.toLowerCase()).toContain("2 minutes");
    expect(ZIP_FULL_EXPORT_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(MEDIA_UPLOAD_CONCURRENCY).toBe(2);
  });

  it("TUS client uses exact 6MiB chunk size and Supabase metadata keys", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(source).toContain("TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024");
    expect(source).toContain("chunkSize: TUS_CHUNK_SIZE_BYTES");
    expect(source).toContain("bucketName:");
    expect(source).toContain("objectName:");
    expect(source).toContain("contentType:");
    expect(source).toContain("cacheControl:");
    expect(source).toContain("x-upsert");
    expect(source).toContain("media/complete");
    expect(source).toContain("resolveAccessToken");
    expect(source).toContain("discardMediaUpload");
  });

  it("builds identifiable zip filenames from section + item + index", () => {
    expect(
      buildMediaExportFilename({
        sectionTitle: "ELECTRICAL",
        itemTitle: "Panel photo",
        index: 0,
        mediaType: "photo",
        ext: "jpg",
      }),
    ).toBe("ELECTRICAL__Panel_photo__photo_01.jpg");
    expect(
      buildMediaExportFilename({
        sectionTitle: null,
        itemTitle: "Front Photo",
        index: 1,
        mediaType: "video",
        ext: "mp4",
      }),
    ).toBe("standalone__Front_Photo__video_02.mp4");
  });
});

describe("prepare → complete direct-upload path", () => {
  it("creates pending media then marks ready without FormData through Next", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const clientMediaId = "11111111-1111-4111-8111-111111111111";

    const prepared = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      clientMediaId,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 1200,
      actorId: "user-1",
    });
    expect(prepared.media.uploadStatus).toBe("pending");
    expect(prepared.media.clientMediaId).toBe(clientMediaId);
    expect(prepared.upload.mode).toBe("memory");

    putMemoryMediaBytes({
      storagePath: prepared.upload.path,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });

    const uploading = await updateSiteInspectionMediaStatus({
      inspectionId: inspection.id,
      clientMediaId,
      uploadStatus: "uploading",
      uploadProgress: 0.5,
    });
    expect(uploading.media.find((m) => m.clientMediaId === clientMediaId)?.uploadProgress).toBe(
      0.5,
    );

    const done = await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      storagePath: prepared.upload.path,
      byteSize: 1200,
      actorId: "user-1",
    });
    const media = done.media.find((m) => m.clientMediaId === clientMediaId)!;
    expect(media.uploadStatus).toBe("ready");
    expect(done.coverMediaId).toBeTruthy();
    expect(done.pendingMediaCount).toBe(0);
  });

  it("surfaces pending/failed counts on list cards", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      clientMediaId: "22222222-2222-4222-8222-222222222222",
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 10,
      actorId: "user-1",
    });
    await updateSiteInspectionMediaStatus({
      inspectionId: inspection.id,
      clientMediaId: "22222222-2222-4222-8222-222222222222",
      uploadStatus: "failed",
    });
    const list = await listSiteInspections();
    const row = list.find((r) => r.id === inspection.id)!;
    expect(row.failedMediaCount).toBe(1);
  });

  it("video prepare returns tus mode outside memory (shape check via photo memory + code)", () => {
    const queueSource = readFileSync(
      join(process.cwd(), "src/lib/inspections/media-queue.ts"),
      "utf8",
    );
    expect(queueSource).toContain("tus-js-client");
    expect(queueSource).toContain("resumeFromPreviousUpload");
    expect(queueSource).toContain("MEDIA_UPLOAD_CONCURRENCY");
    expect(queueSource).toContain("indexedDB");

    const storeSource = readFileSync(
      join(process.cwd(), "src/lib/inspections/records-store.ts"),
      "utf8",
    );
    expect(storeSource).toContain("upload/resumable");
    expect(storeSource).toContain('mode: "tus"');
  });
});

describe("legacy FormData path retired + export streaming", () => {
  it("media POST route returns 410 and does not accept file bytes", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/inspections/[id]/media/route.ts"),
      "utf8",
    );
    expect(source).toContain("410");
    expect(source).not.toContain("formData");
    expect(source).not.toContain("uploadSiteInspectionPhoto");
  });

  it("prepare/complete routes never read file bodies", () => {
    for (const file of [
      "src/app/api/inspections/[id]/media/prepare/route.ts",
      "src/app/api/inspections/[id]/media/complete/route.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toContain("formData");
      expect(source).not.toContain("arrayBuffer");
      expect(source).toContain("request.json");
    }
  });

  it("export route streams zip with ZipArchive, maxDuration, and size guard", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/inspections/[id]/export/route.ts"),
      "utf8",
    );
    expect(source).toContain("ZipArchive");
    expect(source).toContain("new ZipArchive");
    expect(source).toContain("PassThrough");
    expect(source).toContain("maxDuration = 300");
    expect(source).toContain("ZIP_FULL_EXPORT_MAX_BYTES");
    expect(source).toContain("buildMediaExportFilename");
    expect(source).toContain("mode=photos");
    expect(source).toContain("No ready media to export");
    expect(source).not.toContain('createArchive("zip"');
  });

  it("still supports test helper attach after server-side upload", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const uploaded = await uploadSiteInspectionPhoto({
      userId: "user-1",
      inspectionId: inspection.id,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      filename: "cover.jpg",
    });
    const withCover = await attachSiteInspectionPhoto({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      storagePath: uploaded.storagePath,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.sizeBytes,
      actorId: "user-1",
    });
    expect(withCover.coverMediaId).toBeTruthy();
  });
});

describe("PWA manifest scoped to /inspections", () => {
  it("route module declares standalone start_url /inspections", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/inspections/manifest.webmanifest/route.ts"),
      "utf8",
    );
    expect(source).toContain('start_url: "/inspections"');
    expect(source).toContain('scope: "/inspections"');
    expect(source).toContain('display: "standalone"');
    expect(source).toContain("/icons/inspections-192.png");
    expect(source).toContain("/icons/inspections-512.png");
  });

  it("layout links manifest and documents iOS standalone cookie jar", () => {
    const source = readFileSync(join(process.cwd(), "src/app/inspections/layout.tsx"), "utf8");
    expect(source).toContain('manifest: "/inspections/manifest.webmanifest"');
    expect(source).toContain("appleWebApp");
    expect(source.toLowerCase()).toContain("cookie jar");
  });
});

describe("signed upload helper exists in storage-js", () => {
  it("createSignedUploadUrl is available on the installed client", () => {
    const source = readFileSync(
      join(process.cwd(), "node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts"),
      "utf8",
    );
    expect(source).toContain("createSignedUploadUrl");
    expect(source).toContain("uploadToSignedUrl");
    // No first-party TUS wrapper — video uses tus-js-client against /upload/resumable
    expect(source.toLowerCase()).not.toContain("tus-js-client");
  });
});
