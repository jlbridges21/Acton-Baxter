import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import {
  deleteKnowledgeDocument,
  getDocumentPreview,
  updateDocumentMetadata,
} from "@/lib/agents/knowledge";
import { documentAccess } from "@/lib/agents/knowledge-access";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { accessByAgent } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const { doc, agentIds, canRead, canManage } = await documentAccess(ctx.requester, id);
    if (!doc || !canRead) throw new NotFoundError("Document not found");
    if (doc.sensitivity !== "internal") {
      await recordAudit({
        actor: actorOf(ctx),
        action: "knowledge.viewed",
        targetType: "knowledge_document",
        targetId: id,
        summary: `Viewed ${doc.sensitivity} document "${doc.title}".`,
      });
    }
    return jsonOk({
      document: { ...doc, agentIds },
      canManage,
      preview: (await getDocumentPreview(id, 12)).map((c) => ({
        ordinal: c.ordinal,
        heading: c.heading,
        content: c.content,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/knowledge/[id]");
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().min(1).max(80).optional(),
  sensitivity: z.enum(["internal", "confidential", "restricted"]).optional(),
  status: z.enum(["ready", "archived"]).optional(),
  agentIds: z.array(z.string().uuid()).min(1).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const { doc, canManage } = await documentAccess(ctx.requester, id);
    if (!doc || !canManage) throw new NotFoundError("Document not found");
    const input = patchSchema.parse(await request.json());
    if (input.status === "ready" && doc.status !== "archived") delete input.status;
    if (input.agentIds) {
      const access = await accessByAgent(ctx.requester);
      if (!input.agentIds.every((a) => access.get(a)?.has("manage"))) {
        throw new AuthorizationError("You can only assign documents to agents you manage.");
      }
    }
    const { agentIds, ...patch } = input;
    const updated = await updateDocumentMetadata(id, patch, agentIds);
    await recordAudit({
      actor: actorOf(ctx),
      action: input.status === "archived" ? "knowledge.archived" : "knowledge.updated",
      targetType: "knowledge_document",
      targetId: id,
      summary: `Updated ${Object.keys(input).join(", ")} on "${doc.title}".`,
    });
    return jsonOk({ document: updated });
  } catch (error) {
    return jsonError(error, "PATCH /api/ai/knowledge/[id]");
  }
}

/** Permanent removal is admin-only; managers archive instead. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const { id } = await params;
    const { doc } = await documentAccess(ctx.requester, id);
    if (!doc) throw new NotFoundError("Document not found");
    await deleteKnowledgeDocument(id);
    await recordAudit({
      actor: actorOf(ctx),
      action: "knowledge.deleted",
      targetType: "knowledge_document",
      targetId: id,
      summary: `Permanently deleted "${doc.title}".`,
    });
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/ai/knowledge/[id]");
  }
}
