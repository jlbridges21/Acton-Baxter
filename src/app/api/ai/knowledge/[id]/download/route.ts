import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { createSignedDownloadUrl } from "@/lib/agents/knowledge";
import { documentAccess } from "@/lib/agents/knowledge-access";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Redirect to a 60-second signed URL for the original file after authorization. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const { doc, canRead } = await documentAccess(ctx.requester, id);
    if (!doc || !canRead) throw new NotFoundError("Document not found");
    const url = await createSignedDownloadUrl(doc);
    if (!url) throw new NotFoundError("The original file is not available.");
    await recordAudit({
      actor: actorOf(ctx),
      action: "knowledge.downloaded",
      targetType: "knowledge_document",
      targetId: id,
      summary: `Downloaded "${doc.title}" (${doc.sensitivity}).`,
    });
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return jsonError(error, "GET /api/ai/knowledge/[id]/download");
  }
}
