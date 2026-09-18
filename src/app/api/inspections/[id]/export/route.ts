/**
 * Streaming zip export of inspection media for BuilderTrend / off-platform use.
 *
 * archiver v8 exports `ZipArchive` (class), not a callable `archiver(format)` factory.
 * Calling the old factory threw TypeError → generic "An unexpected error occurred".
 */
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { getSiteInspection } from "@/lib/inspections/records-store";
import { downloadSiteInspectionMediaBytes } from "@/lib/inspections/media-storage";
import {
  ZIP_FULL_EXPORT_MAX_BYTES,
  buildMediaExportFilename,
} from "@/lib/inspections/media-limits";
import { listSnapshotItems } from "@/lib/inspections/snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

function extFor(mediaType: "photo" | "video", mimeType: string | null, path: string | null) {
  if (path?.includes(".")) {
    const fromPath = path.split(".").pop()?.toLowerCase();
    if (fromPath && fromPath.length <= 5) return fromPath;
  }
  if (mediaType === "video") {
    if (mimeType?.includes("quicktime")) return "mov";
    return "mp4";
  }
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  return "jpg";
}

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const url = new URL(request.url);
    const mode = (url.searchParams.get("mode") ?? "full") as "full" | "photos" | "section";
    const sectionId = url.searchParams.get("sectionId");

    const inspection = await getSiteInspection(id);
    const items = listSnapshotItems(inspection.snapshot);
    const itemMeta = new Map(
      items.map((item) => {
        const section =
          inspection.snapshot.sections.find((s) => s.items.some((i) => i.id === item.id)) ?? null;
        return [
          item.id,
          {
            title: item.title,
            sectionTitle: section?.title ?? null,
            sectionId: section?.id ?? null,
          },
        ] as const;
      }),
    );

    let media = inspection.media.filter((m) => m.uploadStatus === "ready" && m.storagePath);

    if (mode === "photos") {
      media = media.filter((m) => m.mediaType === "photo");
    } else if (mode === "section") {
      if (!sectionId) throw new ValidationError("sectionId is required for section export");
      media = media.filter((m) => itemMeta.get(m.snapshotItemId)?.sectionId === sectionId);
    }

    const totalBytes = media.reduce((sum, m) => sum + (m.byteSize ?? 0), 0);
    if (mode === "full" && totalBytes > ZIP_FULL_EXPORT_MAX_BYTES) {
      throw new ValidationError(
        `This inspection’s media is about ${Math.round(totalBytes / (1024 * 1024))} MB. ` +
          `Download photos only (?mode=photos) or export one section (?mode=section&sectionId=…). ` +
          `Full zip limit is ${Math.round(ZIP_FULL_EXPORT_MAX_BYTES / (1024 * 1024))} MB.`,
      );
    }

    if (!media.length) {
      throw new ValidationError(
        "No ready media to export. Photos or videos may still be uploading, or none were attached.",
      );
    }

    // Resolve bytes before opening the response so missing objects become JSON errors,
    // not a broken mid-stream zip.
    const indexByItem = new Map<string, number>();
    const files: Array<{ name: string; bytes: Buffer }> = [];
    let missing = 0;
    for (const m of media) {
      const downloaded = await downloadSiteInspectionMediaBytes(m.storagePath!);
      if (!downloaded) {
        missing += 1;
        console.warn("[GET /api/inspections/[id]/export] missing storage object", {
          inspectionId: id,
          mediaId: m.id,
          storagePath: m.storagePath,
        });
        continue;
      }
      const meta = itemMeta.get(m.snapshotItemId);
      const idx = indexByItem.get(m.snapshotItemId) ?? 0;
      indexByItem.set(m.snapshotItemId, idx + 1);
      files.push({
        name: buildMediaExportFilename({
          sectionTitle: meta?.sectionTitle ?? null,
          itemTitle: meta?.title ?? "item",
          index: idx,
          mediaType: m.mediaType,
          ext: extFor(m.mediaType, m.mimeType ?? downloaded.mimeType, m.storagePath),
        }),
        bytes: downloaded.bytes,
      });
    }

    if (!files.length) {
      throw new ValidationError(
        missing
          ? "Could not download any media files from storage. They may still be uploading or were removed."
          : "No ready media to export. Photos or videos may still be uploading, or none were attached.",
      );
    }

    const passthrough = new PassThrough();
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on("error", (err: Error) => {
      console.error("[GET /api/inspections/[id]/export] archive error", err);
      passthrough.destroy(err);
    });
    archive.pipe(passthrough);

    for (const file of files) {
      archive.append(file.bytes, { name: file.name });
    }
    void archive.finalize().catch((error: unknown) => {
      console.error("[GET /api/inspections/[id]/export] finalize failed", error);
      passthrough.destroy(error instanceof Error ? error : new Error("Export failed"));
    });

    const webStream = Readable.toWeb(passthrough) as unknown as ReadableStream;
    const safeName = inspection.projectName.replace(/[^\w.-]+/g, "_").slice(0, 40) || "inspection";
    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-media.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/[id]/export");
  }
}
