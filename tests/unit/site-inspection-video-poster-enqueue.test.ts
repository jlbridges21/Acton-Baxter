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
  it("does not force camera via capture= on photo/video inputs", () => {
    const runner = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(runner).not.toMatch(/capture=["']environment["']/);
    expect(runner).toContain('accept="image/*"');
    expect(runner).toContain('accept="video/*"');
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
