/**
 * Regression: the L01-26029 LaneLutter incident (Nov 10-11 2026).
 *
 * 45 files sat at "0%" — first reported as queued, later as stalled — and
 * Retry All made no difference. Three independent defects combined:
 *
 *   1. A video transfer had no no-progress timeout, only a 3-hour wall clock.
 *   2. Concurrency was 1 across all media, so that one video blocked every
 *      photo behind it.
 *   3. The drain's stuck-state recovery checked `draining`, which is cleared in
 *      a finally, but never `activeUploads`, which is not. A leaked slot wedged
 *      the queue permanently and nothing could clear it.
 *
 * A fourth defect did not cause this incident but could silently destroy field
 * media: any error message containing "not found" or "deleted", or any bare
 * 404, discarded the queued bytes outright.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");

describe("video transfers cannot hold the upload slot indefinitely", () => {
  it("has a no-progress timeout far below the wall-clock ceiling", () => {
    const match = SOURCE.match(/export const TUS_NO_PROGRESS_TIMEOUT_MS = ([\d_]+)/);
    expect(match, "TUS_NO_PROGRESS_TIMEOUT_MS must exist").toBeTruthy();
    const noProgressMs = Number(match![1]!.replace(/_/g, ""));
    expect(noProgressMs).toBeGreaterThan(30_000);
    // The old behaviour was a 3-hour wall clock and nothing else.
    expect(noProgressMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it("rearms the watchdog only on forward byte progress", () => {
    expect(SOURCE).toContain("if (bytesUploaded > lastBytesUploaded)");
    expect(SOURCE).toContain("armNoProgressWatchdog()");
  });

  it("aborts a stalled transfer without terminating the resumable upload", () => {
    // terminate=true sends DELETE and drops the Location, forcing a restart at
    // byte zero. A stall must keep the offset so the retry resumes.
    const watchdog = SOURCE.slice(
      SOURCE.indexOf("const armNoProgressWatchdog"),
      SOURCE.indexOf("const settle = (fn: () => void)"),
    );
    expect(watchdog).toContain("upload?.abort(false)");
    expect(watchdog).not.toContain("upload?.abort(true)");
  });
});

describe("a video does not block photos", () => {
  it("tracks separate in-flight lanes", () => {
    expect(SOURCE).toMatch(/let inFlightVideos = 0;/);
    expect(SOURCE).toMatch(/let inFlightPhotos = 0;/);
  });

  it("picks the first eligible item for a free lane rather than only the head", () => {
    // The old loop did ready.shift() and stopped when the single slot was busy,
    // so a stuck head-of-line video starved everything behind it.
    expect(SOURCE).toContain("ready.findIndex(");
    expect(SOURCE).toContain("ready.splice(index, 1)");
    expect(SOURCE).not.toMatch(/const next = ready\.shift\(\)!;/);
  });

  it("releases the lane it claimed when an upload settles", () => {
    expect(SOURCE).toContain("inFlightVideos = Math.max(0, inFlightVideos - 1)");
    expect(SOURCE).toContain("inFlightPhotos = Math.max(0, inFlightPhotos - 1)");
  });
});

describe("a leaked upload slot cannot wedge the queue", () => {
  it("reclaims slots with no live upload before deciding to skip the drain", () => {
    const drainStart = SOURCE.indexOf("export async function drainMediaQueue");
    const drainHead = SOURCE.slice(drainStart, drainStart + 1200);
    expect(drainHead).toContain("activeUploads > 0 && inFlight.size === 0");
    expect(drainHead).toContain("reclaiming leaked upload slots");
    // The reclaim has to run before the `if (draining) return` short-circuit,
    // otherwise a wedged counter is never examined.
    expect(drainHead.indexOf("reclaiming leaked upload slots")).toBeLessThan(
      drainHead.indexOf("if (draining)"),
    );
  });

  it("resets both lanes wherever the slot count is force-cleared", () => {
    const resets = SOURCE.match(/activeUploads = 0;/g) ?? [];
    const videoResets = SOURCE.match(/inFlightVideos = 0;/g) ?? [];
    expect(videoResets.length).toBeGreaterThanOrEqual(resets.length);
  });
});

describe("queued media is never silently discarded", () => {
  it("treats only 410 Gone as a reason to drop queued bytes", () => {
    const fn = SOURCE.slice(
      SOURCE.indexOf("function isInspectionGoneStatus"),
      SOURCE.indexOf("function isInspectionGoneMessage"),
    );
    expect(fn).toContain("status === 410");
    // A transient 404 from a deploy or cold start must not destroy the only
    // copy of a field photo.
    expect(fn).not.toContain("404");
  });

  it("no longer infers 'gone' from error message text", () => {
    const fn = SOURCE.slice(
      SOURCE.indexOf("function isInspectionGoneMessage"),
      SOURCE.indexOf("function backoffMs"),
    );
    expect(fn).not.toContain('includes("not found")');
    expect(fn).not.toContain('includes("deleted")');
    expect(fn).toContain("return false");
  });

  it("still offers the user a way to rescue queued bytes off the device", () => {
    expect(SOURCE).toContain("export async function listQueuedMediaForDeviceExport");
  });
});
