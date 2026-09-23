import { describe, expect, it } from "vitest";
import { inferInspectionMediaType } from "@/lib/inspections/media-limits";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("inferInspectionMediaType", () => {
  it("routes by MIME type first", () => {
    expect(inferInspectionMediaType(new File([], "x.bin", { type: "image/jpeg" }))).toBe("photo");
    expect(inferInspectionMediaType(new File([], "x.bin", { type: "video/mp4" }))).toBe("video");
  });

  it("falls back to extension when MIME is missing (Files/Drive)", () => {
    expect(inferInspectionMediaType(new File([], "site.HEIC", { type: "" }))).toBe("photo");
    expect(inferInspectionMediaType(new File([], "walkthrough.MOV", { type: "" }))).toBe("video");
    expect(inferInspectionMediaType(new File([], "notes.pdf", { type: "" }))).toBeNull();
  });
});

describe("inspection media capture controls", () => {
  it("defines Take photo, Take video, and Attach file inputs with correct attributes", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(source).toContain("Take photo");
    expect(source).toContain("Take video");
    expect(source).toContain("Attach file");
    expect(source).toContain('accept="image/*"');
    expect(source).toContain('accept="video/*"');
    expect(source).toContain('accept="image/*,video/*"');
    expect(source).toContain('capture="environment"');
    expect(source).toContain("inferInspectionMediaType");
    expect(source).toContain("shouldShowCameraCaptureButtons");
    // Capture inputs must not share the attach-file input (no capture on attach).
    expect(source).toMatch(/ref=\{attachFileRef\}[\s\S]*?accept="image\/\*,video\/\*"/);
  });
});
