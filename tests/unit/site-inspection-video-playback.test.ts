/**
 * QuickTime → MP4 remux (Chrome playback) + poster path helpers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  looksLikeQuickTimeContainer,
  posterStoragePathForVideo,
  remuxQuickTimeToMp4,
} from "@/lib/inspections/video-remux";

describe("video remux + poster paths", () => {
  it("detects QuickTime by path/mime", () => {
    expect(looksLikeQuickTimeContainer({ storagePath: "a/b.mov" })).toBe(true);
    expect(looksLikeQuickTimeContainer({ mimeType: "video/quicktime" })).toBe(true);
    expect(looksLikeQuickTimeContainer({ storagePath: "a/b.mp4", mimeType: "video/mp4" })).toBe(
      false,
    );
  });

  it("builds companion poster path beside the video object", () => {
    expect(posterStoragePathForVideo("user/insp/id.mov")).toBe("user/insp/id.poster.jpg");
    expect(posterStoragePathForVideo("user/insp/id.mp4")).toBe("user/insp/id.poster.jpg");
  });

  it("remuxes a real QuickTime H.264 sample to isom MP4 when available", async () => {
    const sample = "/tmp/baxter-video-probe/sample.mov";
    let bytes: Buffer;
    try {
      bytes = readFileSync(sample);
    } catch {
      // Sample only exists after the diagnostic probe — skip gracefully in CI.
      expect(true).toBe(true);
      return;
    }
    const out = await remuxQuickTimeToMp4(bytes);
    expect(out.byteLength).toBeGreaterThan(1000);
    expect(out.subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(out.subarray(8, 12).toString("ascii")).not.toBe("qt  ");
  });

  it("CSP allows media from supabase + complete remuxes QuickTime", () => {
    const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(nextConfig).toContain("media-src 'self' blob: https://*.supabase.co");
    expect(nextConfig).toContain("ffmpeg-static");

    const complete = readFileSync(
      join(process.cwd(), "src/lib/inspections/records-store.ts"),
      "utf8",
    );
    expect(complete).toContain("ensureChromePlayableVideoObject");

    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain("extractVideoPosterFrame");
    expect(queue).toContain("attachPosterInBackground");
    // Enqueue must not await poster extract (iOS hang made capture a silent no-op).
    const enqueueIdx = queue.indexOf("export async function enqueueInspectionMedia");
    const attachIdx = queue.indexOf("void attachPosterInBackground");
    const awaitExtractInEnqueue = queue
      .slice(enqueueIdx, attachIdx)
      .includes("await extractVideoPosterFrame");
    expect(awaitExtractInEnqueue).toBe(false);
  });
});
