import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { loadUploadPdfBytes, resolveKnowledgeSourceFile } from "@/lib/knowledge/source-file";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseRangeHeader(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  // Support a single range only (browser PDF viewers).
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return "unsatisfiable";
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return "unsatisfiable";

  let start: number;
  let end: number;
  if (!startRaw) {
    // suffix: bytes=-N
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "unsatisfiable";
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

/**
 * Secure PDF source access for Knowledge Center.
 * - Default / ?mode=meta → JSON with same-origin view/open URLs (never Supabase signed URLs in UI)
 * - ?mode=stream → streams private upload bytes for iframe / Open Original
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError("Invalid knowledge entry id");

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "meta";

    if (mode === "stream") {
      const file = await loadUploadPdfBytes(id);
      if (!file) {
        throw new KnowledgeError(
          "Original PDF unavailable. Baxter still has the previously extracted text for this version.",
          KNOWLEDGE_ERROR_CODES.NOT_FOUND,
          { statusCode: 404 },
        );
      }
      const safeName = file.filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "document.pdf";
      const mimeType = file.mimeType || "application/pdf";
      const bytes = file.bytes;
      const size = bytes.byteLength;
      const range = parseRangeHeader(request.headers.get("range"), size);

      const baseHeaders: Record<string, string> = {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        // Allow this PDF to be framed by Baxter itself (same-origin viewer).
        "X-Frame-Options": "SAMEORIGIN",
      };

      if (range === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${size}`,
          },
        });
      }

      if (range) {
        const slice = bytes.subarray(range.start, range.end + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Length": String(slice.byteLength),
            "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          },
        });
      }

      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          ...baseHeaders,
          "Content-Length": String(size),
        },
      });
    }

    const info = await resolveKnowledgeSourceFile(id);
    return jsonOk({
      source: {
        kind: info.kind,
        mimeType: info.mimeType,
        originalFilename: info.originalFilename,
        viewUrl: info.viewUrl,
        openUrl: info.openUrl,
        googleFileId: info.googleFileId,
        available: info.available,
        unavailableReason: info.unavailableReason,
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge/[id]/source-file");
  }
}
