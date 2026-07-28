import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { loadUploadPdfBytes, resolveKnowledgeSourceFile } from "@/lib/knowledge/source-file";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Secure PDF source access for Knowledge Center.
 * - Default / ?mode=meta → JSON with short-lived view/open URLs (no public permanent links)
 * - ?mode=stream → streams the private upload bytes (auth required; for iframe when signed URL unavailable)
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
      return new Response(new Uint8Array(file.bytes), {
        status: 200,
        headers: {
          "Content-Type": file.mimeType || "application/pdf",
          "Content-Disposition": `inline; filename="${safeName}"`,
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
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
        // Do not expose storage_path to the client UI — only signed/stream URLs.
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge/[id]/source-file");
  }
}
