/**
 * Bucket MIME contract: every content type the app writes to site-inspection-media
 * must be present in the bucket's allowed_mime_types.
 *
 * Regression: a 112-photo inspection took the async PDF export path, the job built
 * the report successfully, then storage rejected application/pdf because the bucket
 * allow-list (047, rewritten by 054) only listed image and video types. The inline
 * path wraps the same store in a catch, so this only ever failed on large
 * inspections and went unnoticed until one appeared in the field.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/**
 * The effective allow-list is whatever the highest-numbered migration that sets
 * allowed_mime_types for this bucket declares. Reading the latest writer rather
 * than a fixed filename is what makes this test survive the next rewrite.
 */
function effectiveAllowedMimeTypes(): { file: string; types: string[] } {
  const candidates = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();

  for (const file of candidates) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (!sql.includes("site-inspection-media")) continue;
    if (!sql.includes("allowed_mime_types")) continue;

    const block = sql.slice(sql.indexOf("allowed_mime_types"));
    const open = block.indexOf("array[");
    if (open === -1) continue;
    const close = block.indexOf("]", open);
    if (close === -1) continue;

    const types = [...block.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    if (types.length > 0) return { file, types };
  }

  throw new Error("No migration sets allowed_mime_types for site-inspection-media");
}

/** Content types passed to uploadSiteInspectionMediaBytes anywhere in the app. */
function uploadedContentTypes(): Array<{ source: string; mimeType: string }> {
  const found: Array<{ source: string; mimeType: string }> = [];
  const files = [
    "src/lib/inspections/ai/export-pdf.tsx",
    "src/lib/inspections/media-storage.ts",
    "src/lib/inspections/video-poster-server.ts",
    "src/lib/inspections/street-view-cover.ts",
    "src/lib/inspections/street-view-backfill.ts",
  ];
  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(join(process.cwd(), rel), "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/mimeType:\s*"([a-z]+\/[a-z0-9.+-]+)"/g)) {
      found.push({ source: rel, mimeType: match[1]! });
    }
  }
  return found;
}

describe("site-inspection-media bucket MIME contract", () => {
  it("allows the generated PDF export", () => {
    const { types } = effectiveAllowedMimeTypes();
    expect(types).toContain("application/pdf");
  });

  it("still allows the photo and video types the field app captures", () => {
    const { types } = effectiveAllowedMimeTypes();
    for (const required of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/quicktime",
    ]) {
      expect(types).toContain(required);
    }
  });

  it("allows every content type the app actually uploads", () => {
    const { types, file } = effectiveAllowedMimeTypes();
    const uploads = uploadedContentTypes();
    expect(uploads.length).toBeGreaterThan(0);

    const rejected = uploads.filter((u) => !types.includes(u.mimeType));
    expect(
      rejected,
      `These content types are written to site-inspection-media but are not in the ` +
        `allow-list declared by ${file}. Storage will reject them at upload time:\n` +
        rejected.map((r) => `  ${r.mimeType} (${r.source})`).join("\n"),
    ).toEqual([]);
  });

  it("stores the PDF export under an exports prefix, not as checklist media", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/inspections/ai/export-pdf.tsx"),
      "utf8",
    );
    expect(source).toContain("/exports/");
    expect(source).toContain("application/pdf");
  });
});
