/**
 * Posters are generated server-side (ffmpeg). Client extract is retired.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("video poster — server path", () => {
  it("media queue no longer extracts posters on-device", () => {
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).not.toContain("extractVideoPosterFrame");
    expect(queue).not.toContain("attachPosterInBackground");
    expect(queue).toContain("Posters are generated server-side");
  });

  it("complete path wires ensureServerVideoPoster", () => {
    const store = readFileSync(join(process.cwd(), "src/lib/inspections/records-store.ts"), "utf8");
    expect(store).toContain("ensureServerVideoPoster");
    expect(store).toContain("server poster extract failed");
  });

  it("server extract seeks past frame zero", () => {
    const server = readFileSync(
      join(process.cwd(), "src/lib/inspections/video-poster-server.ts"),
      "utf8",
    );
    expect(server).toContain("POSTER_SEEK_SECONDS");
    expect(server).toMatch(/0\.5/);
  });
});

describe("inspection capture inputs", () => {
  it("uses bare capture for Take photo/video and leaves Attach file without capture", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    // Bare boolean capture (not valued facing-mode) — more reliable on Android Chrome.
    expect(runner).not.toMatch(/capture=["']environment["']/);
    expect(runner).toContain("capture: true");
    expect(runner).toContain("InspectionMediaPickControl");
    expect(runner).toContain('accept="image/*"');
    expect(runner).toContain('accept="video/*"');
    expect(runner).toContain('accept="image/*,video/*"');
    expect(runner).toContain("Take photo");
    expect(runner).toContain("Take video");
    expect(runner).toContain("Attach file");
    expect(runner).toContain("inferInspectionMediaType");
    expect(runner).not.toMatch(/takePhotoRef\.current\?\.click\(\)/);
  });

  it("photos still run through the client image pipeline on enqueue", () => {
    const queue = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    expect(queue).toContain("processReceiptImage");
    expect(queue).toMatch(/if \(input\.mediaType === "photo"\)[\s\S]*processReceiptImage/);
  });

  it("surfaces empty/failed captures to the user", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(runner).toContain("That capture was empty");
    expect(runner).toContain("window.alert(message)");
  });
});
