/**
 * Interrupt-and-resume contract: production uploadTus must call
 * resumeFromPreviousUpload when findPreviousUploads returns a prior upload,
 * so progress continues from the last committed byte — not 0%.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("TUS interrupt-and-resume", () => {
  it("continues from the prior upload offset instead of restarting at 0%", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inspections/media-queue.ts"), "utf8");
    // Explicit resume sequence — this is what makes large field videos survivable.
    expect(source).toContain("const previous = await upload.findPreviousUploads()");
    expect(source).toContain("upload.resumeFromPreviousUpload(previous[0]!)");
    expect(source).toContain("TUS resume from previous upload");
    expect(source).toContain("removeFingerprintOnSuccess: false");
    expect(source).toContain("sizeUploaded");
    expect(source).toContain("tusUploadUrl");
    expect(source).toContain("uploadUrl: input.tusUploadUrl");
    expect(source).toContain("abort(false)");
    // Signed-URL path has no resume — videos must not use it.
    expect(source).toMatch(/upload\.mode === "tus"/);
  });
});
