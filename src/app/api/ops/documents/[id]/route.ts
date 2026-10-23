import { jsonError } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { requireAiContext } from "@/lib/agents/http";
import { opsAccessFor } from "@/lib/ops/commands";
import { assertCanSeeDocument, getOpsDocument, readOpsDocumentBytes } from "@/lib/ops/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Download a private document (access-checked and audited). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const access = await opsAccessFor(ctx);
    const doc = await getOpsDocument(id);
    await assertCanSeeDocument(doc, access);
    const bytes = await readOpsDocumentBytes(doc);
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.user.profile.full_name || ctx.user.email },
      action: "ops.document_viewed",
      targetType: "ops_document",
      targetId: doc.id,
      summary: `Viewed a ${doc.category} document.`,
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `attachment; filename="${doc.filename.replace(/[^\w .()-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/ops/documents/[id]");
  }
}
