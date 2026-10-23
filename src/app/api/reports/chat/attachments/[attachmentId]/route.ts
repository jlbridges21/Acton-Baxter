import { jsonError } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { getAttachmentFor, readAttachmentBytes } from "@/lib/reports/attachments";
import { requireReportsContext } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ attachmentId: string }> };

/** The file itself, for thumbnails and previews — only to the person who uploaded it. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { attachmentId } = await params;
    const row = await getAttachmentFor(attachmentId, ctx.user.id);
    const bytes = await readAttachmentBytes(row);
    if (!bytes) throw new NotFoundError("The file is no longer available.");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": `${row.kind === "image" ? "inline" : "attachment"}; filename="${row.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/chat/attachments/[attachmentId]");
  }
}
