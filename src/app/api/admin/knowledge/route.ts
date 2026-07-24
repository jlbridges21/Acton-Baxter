import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { knowledgeEntryWriteSchema, knowledgeListQuerySchema } from "@/lib/knowledge/schemas";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";
import { adminCreateKnowledgeEntry } from "@/lib/knowledge/mutations";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const parsed = knowledgeListQuerySchema.parse({
      q: searchParams.get("q") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      source_type: searchParams.get("source_type") ?? undefined,
      tag: searchParams.get("tag") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
    });
    const entries = await listKnowledgeEntries(parsed);
    return jsonOk({ entries, count: entries.length });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = knowledgeEntryWriteSchema.parse(body);
    const entry = await adminCreateKnowledgeEntry(user.profile.role, user.id, parsed);
    return jsonOk({ entry }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/knowledge");
  }
}
