import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { knowledgeEntryWriteSchema } from "@/lib/knowledge/schemas";
import { getKnowledgeEntry, listKnowledgeEntryRevisions } from "@/lib/knowledge/queries";
import {
  adminDeleteKnowledgeEntry,
  adminSetKnowledgeStatus,
  adminUpdateKnowledgeEntry,
} from "@/lib/knowledge/mutations";
import { isUuid } from "@/lib/utils";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError("Invalid knowledge entry id");
    const entry = await getKnowledgeEntry(id);
    if (!entry) throw new ValidationError("Knowledge entry not found");
    const revisions = await listKnowledgeEntryRevisions(id);
    return jsonOk({ entry, revisions });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge/[id]");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError("Invalid knowledge entry id");
    const body = await request.json();
    const parsed = knowledgeEntryWriteSchema.parse(body);
    const entry = await adminUpdateKnowledgeEntry(user.profile.role, user.id, id, parsed);
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error, "PUT /api/admin/knowledge/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError("Invalid knowledge entry id");
    const body = z
      .object({ status: z.enum(["draft", "approved", "archived"]) })
      .parse(await request.json());
    const entry = await adminSetKnowledgeStatus(user.profile.role, user.id, id, body.status);
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/knowledge/[id]");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError("Invalid knowledge entry id");
    await adminDeleteKnowledgeEntry(user.profile.role, id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/admin/knowledge/[id]");
  }
}
