/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { inferInspectionMediaType } from "@/lib/inspections/media-limits";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  it("defines Take photo, Take video, and Attach file with bare capture (not valued facing mode)", () => {
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
    expect(source).toContain("InspectionMediaPickControl");
    expect(source).toContain("inferInspectionMediaType");
    expect(source).toContain("shouldShowCameraCaptureButtons");
    // Prefer bare boolean capture over valued facing-mode form for Android Chrome.
    expect(source).not.toMatch(/capture=["']environment["']/);
    expect(source).toContain("capture: true");
    // Must not trigger via programmatic inputRef.click() from a separate button.
    expect(source).not.toMatch(/takePhotoRef\.current\?\.click\(\)/);
    expect(source).not.toMatch(/takeVideoRef\.current\?\.click\(\)/);
  });

  it("renders capture as a live DOM attribute on Take photo/video, not Attach file", () => {
    // Mirrors InspectionMediaPickControl: opacity-0 overlay + bare capture boolean.
    function PickControl({
      label,
      accept,
      capture,
    }: {
      label: string;
      accept: string;
      capture?: boolean;
    }) {
      return createElement(
        "label",
        {
          className: cn(
            buttonVariants({ variant: "secondary", size: "lg" }),
            "relative min-h-11 w-full cursor-pointer overflow-hidden",
          ),
        },
        createElement("span", { className: "pointer-events-none" }, label),
        createElement("input", {
          type: "file",
          accept,
          ...(capture ? { capture: true as const } : {}),
          "aria-label": label,
          className: "absolute inset-0 h-full w-full cursor-pointer opacity-0",
        }),
      );
    }

    render(
      createElement(
        "div",
        null,
        createElement(PickControl, { label: "Take photo", accept: "image/*", capture: true }),
        createElement(PickControl, { label: "Take video", accept: "video/*", capture: true }),
        createElement(PickControl, { label: "Attach file", accept: "image/*,video/*" }),
      ),
    );

    const photo = screen.getByLabelText("Take photo") as HTMLInputElement;
    const video = screen.getByLabelText("Take video") as HTMLInputElement;
    const attach = screen.getByLabelText("Attach file") as HTMLInputElement;

    // React serializes boolean capture as the empty string attribute value.
    expect(photo.getAttribute("capture")).not.toBeNull();
    expect(video.getAttribute("capture")).not.toBeNull();
    expect(attach.getAttribute("capture")).toBeNull();
    expect(photo.accept).toBe("image/*");
    expect(video.accept).toBe("video/*");
    expect(attach.accept).toBe("image/*,video/*");
  });
});
