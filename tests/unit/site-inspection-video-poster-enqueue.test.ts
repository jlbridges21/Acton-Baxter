/**
 * @vitest-environment jsdom
 *
 * Video poster must never block enqueue; capture attrs must not force camera-only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractVideoPosterFrame,
  VIDEO_POSTER_EXTRACT_TIMEOUT_MS,
} from "@/lib/inspections/video-poster";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("video poster extract timeout", () => {
  it("exports a 4s soft deadline", () => {
    expect(VIDEO_POSTER_EXTRACT_TIMEOUT_MS).toBe(4_000);
  });

  it("returns null when decode never fires (does not hang forever)", async () => {
    vi.useFakeTimers();

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "video") {
        // Never fire loadeddata/seeked — mirrors iOS Safari hang.
        Object.defineProperty(el, "play", {
          value: () => Promise.resolve(),
        });
      }
      return el;
    });

    const blob = new Blob([new Uint8Array([0, 0, 0, 0])], { type: "video/mp4" });
    const promise = extractVideoPosterFrame(blob, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(promise).resolves.toBeNull();
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
