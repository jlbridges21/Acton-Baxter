import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { KNOWLEDGE_CATEGORIES } from "@/lib/agents/defaults";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import {
  getDocumentAgentIds,
  listDocumentsForAgent,
  uploadKnowledgeDocument,
} from "@/lib/agents/knowledge";
import { documentAccess } from "@/lib/agents/knowledge-access";
import { listResolvedAgents } from "@/lib/agents/registry";
import { accessByAgent } from "@/lib/agents/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Documents for every agent the requester manages. */
export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
    const access = await accessByAgent(ctx.requester);
    const agents = (await listResolvedAgents()).filter((a) => access.get(a.row.id)?.has("manage"));
    const seen = new Map<
      string,
      Awaited<ReturnType<typeof listDocumentsForAgent>>[number] & { agentIds: string[] }
    >();
    for (const agent of agents) {
      for (const doc of await listDocumentsForAgent(agent.row.id, { includeArchived })) {
        if (!seen.has(doc.id))
          seen.set(doc.id, { ...doc, agentIds: await getDocumentAgentIds(doc.id) });
      }
    }
    return jsonOk({
      canManage: agents.length > 0,
      agents: agents.map((a) => ({ id: a.row.id, slug: a.row.slug, name: a.row.display_name })),
      categories: KNOWLEDGE_CATEGORIES,
      documents: [...seen.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/knowledge");
  }
}

const formSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
  category: z.string().trim().min(1).max(80),
  sensitivity: z.enum(["internal", "confidential", "restricted"]),
  agentIds: z.array(z.string().uuid()).min(1, "Choose at least one agent."),
  replacesDocumentId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose a file to upload.");
    const input = formSchema.parse({
      title: form.get("title") || file.name,
      description: form.get("description") ?? undefined,
      category: form.get("category") || "general",
      sensitivity: form.get("sensitivity") || "confidential",
      agentIds: form.getAll("agentIds").map(String),
      replacesDocumentId: form.get("replacesDocumentId") || null,
    });
    const access = await accessByAgent(ctx.requester);
    if (!input.agentIds.every((id) => access.get(id)?.has("manage"))) {
      throw new AuthorizationError("You can only add documents to agents you manage.");
    }
    if (
      input.replacesDocumentId &&
      !(await documentAccess(ctx.requester, input.replacesDocumentId)).canManage
    ) {
      throw new AuthorizationError("You can't replace that document.");
    }
    const doc = await uploadKnowledgeDocument({
      ...input,
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || null,
      uploadedBy: ctx.user.id,
    });
    await recordAudit({
      actor: actorOf(ctx),
      action: input.replacesDocumentId ? "knowledge.replaced" : "knowledge.uploaded",
      targetType: "knowledge_document",
      targetId: doc.id,
      summary: `${input.replacesDocumentId ? "Replaced" : "Uploaded"} "${doc.title}" (${doc.sensitivity}, ${doc.status}).`,
      details: { agentIds: input.agentIds, category: doc.category },
    });
    return jsonOk({ document: doc }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ai/knowledge");
  }
}
