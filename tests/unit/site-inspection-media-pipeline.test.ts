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
  deleteSiteInspectionMedia,
  deleteSiteInspectionMediaObject,
  getSiteInspection,
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
import { AuthorizationError } from "@/lib/errors";

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
  it("documents soft video guidance (no hard client size/duration caps)", () => {
    expect(VIDEO_MAX_BYTES).toBe(Number.POSITIVE_INFINITY);
    expect(VIDEO_MAX_DURATION_SECONDS).toBe(Number.POSITIVE_INFINITY);
    expect(VIDEO_WARN_MESSAGE.toLowerCase()).toContain("cell signal");
    expect(ZIP_FULL_EXPORT_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(MEDIA_UPLOAD_CONCURRENCY).toBe(2);
  });

  it("signed-upload queue keeps durable blobs, finalize, and cancel/purge helpers", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(source).toContain("uploadSigned");
    expect(source).toContain("media/complete");
    expect(source).toContain('status: "finalizing"');
    expect(source).toContain("materializeDurableBytes");
    expect(source).toContain("discardMediaUpload");
    expect(source).toContain("cancelAndDiscardMediaUpload");
    expect(source).toContain("cancelledUploads");
    expect(source).toContain("activeAbortByClientId");
    expect(source).toContain("purgeMediaQueueForInspection");
    expect(source).toContain("purgeOrphanMediaQueueEntries");
    expect(source).toContain("inspectionId: options?.inspectionId");
    expect(source).toContain("UPLOAD_STALL_TIMEOUT_MS");
    expect(source).toContain("withIdbRetry");
    expect(source).toContain("onclose");
    expect(source).toContain("onversionchange");
    // Persist Blob only — resident ArrayBuffers caused Safari IDB reclaim under many videos.
    expect(source).toContain("Persist the Blob only");
    expect(source).not.toContain("tus-js-client");
    // Auth for signed uploads is in the URL token — no Authorization header construction.
    expect(source).toContain("redactApiKeyForLog");
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
  it("mints upload credentials without a media row, then creates ready on complete", async () => {
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
    expect(prepared.upload.mode).toBe("memory");
    const before = await getSiteInspection(inspection.id);
    expect(before.media.find((m) => m.clientMediaId === clientMediaId)).toBeUndefined();

    putMemoryMediaBytes({
      storagePath: prepared.upload.path,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });

    const done = await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      snapshotItemId: cover.id,
      mediaType: "photo",
      mimeType: "image/jpeg",
      storagePath: prepared.upload.path,
      byteSize: 1200,
      actorId: "user-1",
    });
    const media = done.media.find((m) => m.clientMediaId === clientMediaId)!;
    expect(media.uploadStatus).toBe("ready");
    expect(done.coverMediaId).toBeTruthy();
    expect(done.pendingMediaCount).toBe(0);
  });

  it("surfaces failed counts only after a ready row exists then fails", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const clientMediaId = "22222222-2222-4222-8222-222222222222";
    const prepared = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      clientMediaId,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 10,
      actorId: "user-1",
    });
    putMemoryMediaBytes({
      storagePath: prepared.upload.path,
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });
    await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      snapshotItemId: cover.id,
      mediaType: "photo",
      mimeType: "image/jpeg",
      storagePath: prepared.upload.path,
      byteSize: 10,
      actorId: "user-1",
    });
    await updateSiteInspectionMediaStatus({
      inspectionId: inspection.id,
      clientMediaId,
      uploadStatus: "failed",
    });
    const list = await listSiteInspections();
    const row = list.find((r) => r.id === inspection.id)!;
    expect(row.failedMediaCount).toBe(1);
  });

  it("video and photo prepare both use signed/memory — not TUS (debt)", () => {
    const queueSource = readFileSync(
      join(process.cwd(), "src/lib/inspections/media-queue.ts"),
      "utf8",
    );
    expect(queueSource).toContain("uploadSigned");
    expect(queueSource).toContain("MEDIA_UPLOAD_CONCURRENCY");
    expect(queueSource).toContain("indexedDB");
    expect(queueSource).not.toContain("tus-js-client");

    const storeSource = readFileSync(
      join(process.cwd(), "src/lib/inspections/records-store.ts"),
      "utf8",
    );
    expect(storeSource).toContain("createSignedUploadForPath");
    expect(storeSource).toContain('mode: "signed"');
    expect(storeSource).not.toContain('mode: "tus"');
    // TUS endpoint helper kept for a future resumable return.
    const limits = readFileSync(join(process.cwd(), "src/lib/inspections/media-limits.ts"), "utf8");
    expect(limits).toContain("supabaseResumableUploadEndpoint");
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

describe("delete media + cover fallback + permissions", () => {
  it("removes the row and storage object, and falls back cover photo", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;

    async function addPhoto(clientMediaId: string, bytes: number[]) {
      const prepared = await prepareSiteInspectionMedia({
        inspectionId: inspection.id,
        snapshotItemId: cover.id,
        clientMediaId,
        mediaType: "photo",
        mimeType: "image/jpeg",
        byteSize: bytes.length,
        actorId: "user-1",
      });
      putMemoryMediaBytes({
        storagePath: prepared.upload.path,
        bytes: Buffer.from(bytes),
        mimeType: "image/jpeg",
        uploadedBy: "user-1",
      });
      return completeSiteInspectionMedia({
        inspectionId: inspection.id,
        clientMediaId,
        snapshotItemId: cover.id,
        mediaType: "photo",
        mimeType: "image/jpeg",
        storagePath: prepared.upload.path,
        byteSize: bytes.length,
        actorId: "user-1",
      });
    }

    const first = await addPhoto("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [0xff, 0xd8, 0xff, 0xd9]);
    const second = await addPhoto(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      [0xff, 0xd8, 0xff, 0xd8, 0xd9],
    );
    const coverId = first.coverMediaId ?? second.coverMediaId;
    expect(coverId).toBeTruthy();
    const coverMedia = second.media.find((m) => m.id === coverId)!;
    const other = second.media.find((m) => m.id !== coverId && m.uploadStatus === "ready")!;

    const after = await deleteSiteInspectionMedia({
      inspectionId: inspection.id,
      mediaId: coverMedia.id,
      actorId: "user-1",
      actorRole: "technician",
    });
    expect(after.media.find((m) => m.id === coverMedia.id)).toBeUndefined();
    expect(after.coverMediaId).toBe(other.id);
    expect(after.coverMediaId).not.toBe(coverMedia.id);

    await expect(deleteSiteInspectionMediaObject(coverMedia.storagePath!)).resolves.toBeUndefined();
  });

  it("allows lookup by clientMediaId and rejects non-uploader non-admin", async () => {
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const clientMediaId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const prepared = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      clientMediaId,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 8,
      actorId: "user-1",
    });
    putMemoryMediaBytes({
      storagePath: prepared.upload.path,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });
    await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      snapshotItemId: cover.id,
      mediaType: "photo",
      mimeType: "image/jpeg",
      storagePath: prepared.upload.path,
      byteSize: 8,
      actorId: "user-1",
    });

    await expect(
      deleteSiteInspectionMedia({
        inspectionId: inspection.id,
        mediaId: clientMediaId,
        actorId: "user-2",
        actorRole: "technician",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const deleted = await deleteSiteInspectionMedia({
      inspectionId: inspection.id,
      mediaId: clientMediaId,
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(deleted.media.find((m) => m.clientMediaId === clientMediaId)).toBeUndefined();
  });

  it("DELETE route exists alongside retired POST 410", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/inspections/[id]/media/route.ts"),
      "utf8",
    );
    expect(source).toContain("export async function DELETE");
    expect(source).toContain("deleteSiteInspectionMedia");
    expect(source).toContain("410");
  });

  it("rotate 90° CCW four times returns to original bytes (persisted)", async () => {
    const { rotateSiteInspectionMedia } = await import("@/lib/inspections/records-store");
    const inspection = await seededInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const clientMediaId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    // 2×3 JPEG-ish payload distinguished by sharp after rotate — use a real tiny PNG via sharp if available
    const sharp = (await import("sharp")).default;
    const original = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      clientMediaId,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: original.byteLength,
      actorId: "user-1",
    });
    putMemoryMediaBytes({
      storagePath: prepared.upload.path,
      bytes: original,
      mimeType: "image/jpeg",
      uploadedBy: "user-1",
    });
    const ready = await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      snapshotItemId: cover.id,
      mediaType: "photo",
      mimeType: "image/jpeg",
      storagePath: prepared.upload.path,
      byteSize: original.byteLength,
      actorId: "user-1",
    });
    const mediaId = ready.media.find((m) => m.clientMediaId === clientMediaId)!.id;

    const dims: Array<{ w: number; h: number }> = [];
    for (let i = 0; i < 4; i += 1) {
      await rotateSiteInspectionMedia({
        inspectionId: inspection.id,
        mediaId,
        actorId: "user-1",
        actorRole: "technician",
      });
      const { downloadSiteInspectionMediaBytes } = await import("@/lib/inspections/media-storage");
      const downloaded = await downloadSiteInspectionMediaBytes(prepared.upload.path);
      expect(downloaded).toBeTruthy();
      const meta = await sharp(downloaded!.bytes).metadata();
      dims.push({ w: meta.width!, h: meta.height! });
    }
    // After 1 and 3 rotates: swapped; after 2 and 4: original orientation
    expect(dims[0]).toEqual({ w: 2, h: 4 });
    expect(dims[1]).toEqual({ w: 4, h: 2 });
    expect(dims[2]).toEqual({ w: 2, h: 4 });
    expect(dims[3]).toEqual({ w: 4, h: 2 });
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
