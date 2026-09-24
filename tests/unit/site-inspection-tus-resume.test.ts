/**
 * TUS resume + serial large-video drain + per-item cancel contracts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LARGE_VIDEO_SERIAL_BYTES, TUS_CHUNK_SIZE_BYTES } from "@/lib/inspections/media-limits";

describe("resumable video upload contracts", () => {
  it("uses 6 MiB TUS chunks and resumes from previous uploads", () => {
    expect(TUS_CHUNK_SIZE_BYTES).toBe(6 * 1024 * 1024);
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain('from "tus-js-client"');
    expect(queue).toContain("resumeFromPreviousUpload");
    expect(queue).toContain("findPreviousUploads");
    expect(queue).toContain("removeFingerprintOnSuccess: false");
    expect(queue).toContain("uploadTus");
    expect(queue).toContain("TUS resume from previous upload");
    expect(queue).toContain("tusUploadUrl");
    // apikey / x-upsert stay in `headers` only. A second setHeader makes browser XHR concatenate.
    expect(queue).not.toMatch(/req\.setHeader\("apikey"/);
    expect(queue).not.toMatch(/req\.setHeader\("x-upsert"/);
    expect(queue).toContain('req.setHeader("Authorization"');
  });

  it("serializes large videos while keeping photo concurrency", () => {
    expect(LARGE_VIDEO_SERIAL_BYTES).toBe(20 * 1024 * 1024);
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain("largeVideoUploading");
    expect(queue).toContain("isLargeVideoItem");
    expect(queue).toContain("LARGE_VIDEO_SERIAL_BYTES");
  });

  it("refreshes expired signed URLs for photos instead of failing cold", () => {
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain("isSignedUrlExpiredError");
    expect(queue).toContain("signed URL expired — re-preparing");
  });

  it("runner exposes per-item Cancel for queued uploads", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(runner).toContain("Cancel this");
    expect(runner).toContain("cancelAndDiscardMediaUpload(item.clientMediaId)");
    expect(runner).toContain("Retry all uploads");
    expect(runner).toContain("Save queued media to device");
  });

  it("ships storage RLS migration for authenticated TUS", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/054_site_inspection_media_tus_rls.sql"),
      "utf8",
    );
    expect(migration).toContain("Users can upload own site inspection media");
    expect(migration).toContain("Users can update own site inspection media");
    expect(migration).toContain("Users can read own site inspection media");
    expect(migration).toContain("No client insert site inspection media");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("site-inspection-media");
  });

  it("widens site-inspection-media RLS to the shared bucket, not the uploader UUID", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/055_site_inspection_media_shared_tus_rls.sql"),
      "utf8",
    );
    const sql = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).toContain("bucket_id = 'site-inspection-media'");
    expect(sql).toContain("for insert");
    expect(sql).toContain("for update");
    expect(sql).toContain("for select");
    expect(sql).toContain("for delete");
    expect(sql).not.toContain("auth.uid()");
    expect(sql).not.toContain("storage.foldername");
  });

  it("keeps queue blobs disk-backed (no resident ArrayBuffer on items)", () => {
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain("Persist the Blob only");
    expect(queue).toContain("do NOT keep the intermediate ArrayBuffer");
  });
});
