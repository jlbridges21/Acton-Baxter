import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { knowledgeEntryWriteSchema } from "@/lib/knowledge/schemas";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";
import { filterKnowledgeVisibleToUser } from "@/lib/knowledge/permissions";
import { userCreateKnowledgeDraft } from "@/lib/knowledge/mutations";

export async function GET() {
  try {
    const user = await requireActiveUser();
    const entries = await listKnowledgeEntries({ sort: "updated" });
    const visible = filterKnowledgeVisibleToUser(entries, user.id, user.profile.role);
    return jsonOk({ entries: visible, count: visible.length });
  } catch (error) {
    return jsonError(error, "GET /api/knowledge");
  }
}

/**
 * User-facing create — always persists as draft.
 * Non-admins cannot create or transition to approved/archived via this route;
 * admins approve through /api/admin/knowledge.
 */
export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = await request.json();
    const parsed = knowledgeEntryWriteSchema.parse(body);
    const entry = await userCreateKnowledgeDraft(user.id, parsed);
    return jsonOk({ entry }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/knowledge");
  }
}
