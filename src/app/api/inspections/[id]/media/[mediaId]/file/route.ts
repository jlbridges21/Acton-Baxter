/**
 * Authenticated single-media download / stream (Range-aware).
 * Proxies storage so clients never need a raw signed URL for downloads.
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getSiteInspection } from "@/lib/inspections/records-store";
import { createSiteInspectionMediaSignedUrl } from "@/lib/inspections/media-storage";
import { buildMediaExportFilename } from "@/lib/inspections/media-limits";
import { listSnapshotItems } from "@/lib/inspections/snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; mediaId: string }> };

function extFor(mediaType: "photo" | "video", mimeType: string | null, path: string | null) {
  if (path?.includes(".")) {
    const fromPath = path.split(".").pop()?.toLowerCase();
    if (fromPath && fromPath.length <= 5 && fromPath !== "poster") return fromPath;
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
    const { id: inspectionId, mediaId } = await params;
    const url = new URL(request.url);
    const asDownload = url.searchParams.get("download") === "1";

    const inspection = await getSiteInspection(inspectionId);
    const media =
      inspection.media.find((m) => m.id === mediaId || m.clientMediaId === mediaId) ?? null;
    if (!media || !media.storagePath || media.uploadStatus !== "ready") {
      throw new NotFoundError("Media not found");
    }

    const signed = await createSiteInspectionMediaSignedUrl(media.storagePath, 120);
    if (!signed) throw new ValidationError("Could not open media for download");

    const items = listSnapshotItems(inspection.snapshot);
    const item = items.find((i) => i.id === media.snapshotItemId);
    const section =
      inspection.snapshot.sections.find((s) =>
        s.items.some((i) => i.id === media.snapshotItemId),
      ) ?? null;
    const siblings = inspection.media
      .filter((m) => m.snapshotItemId === media.snapshotItemId && m.uploadStatus === "ready")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = Math.max(
      0,
      siblings.findIndex((m) => m.id === media.id),
    );
    const filename = buildMediaExportFilename({
      sectionTitle: section?.title ?? null,
      itemTitle: item?.title ?? "item",
      index,
      mediaType: media.mediaType,
      ext: extFor(media.mediaType, media.mimeType, media.storagePath),
    });

    const upstreamHeaders: HeadersInit = {};
    const range = request.headers.get("range");
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(signed, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      throw new ValidationError(`Could not fetch media (${upstream.status})`);
    }

    const headers = new Headers();
    const contentType =
      media.mimeType ||
      upstream.headers.get("content-type") ||
      (media.mediaType === "video" ? "video/mp4" : "image/jpeg");
    headers.set("Content-Type", contentType);
    headers.set("Accept-Ranges", "bytes");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);
    if (asDownload) {
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    } else {
      headers.set("Content-Disposition", `inline; filename="${filename}"`);
    }
    headers.set("Cache-Control", "private, max-age=60");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/[id]/media/[mediaId]/file");
  }
}
