import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { knowledgeSourceWriteSchema } from "@/lib/knowledge/schemas";
import { listKnowledgeSources } from "@/lib/knowledge/queries";
import {
  adminCreateKnowledgeSource,
  adminDeleteKnowledgeSource,
  adminUpdateKnowledgeSource,
} from "@/lib/knowledge/mutations";
import { isUuid } from "@/lib/utils";

export async function GET() {
  try {
    await requireAdmin();
    const sources = await listKnowledgeSources();
    return jsonOk({
      sources,
      futureIntegrations: [
        { name: "Google Drive", status: "Not connected" },
        { name: "GoHighLevel", status: "Not connected" },
        { name: "Buildertrend", status: "Not connected" },
        { name: "Domo", status: "Not connected" },
      ],
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge/sources");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const parsed = knowledgeSourceWriteSchema.parse(await request.json());
    const source = await adminCreateKnowledgeSource(user.profile.role, user.id, parsed);
    return jsonOk({ source }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/knowledge/sources");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const id = body.id as string | undefined;
    if (!id || !isUuid(id)) throw new ValidationError("Invalid knowledge source id");
    const parsed = knowledgeSourceWriteSchema.parse(body);
    const source = await adminUpdateKnowledgeSource(user.profile.role, id, parsed);
    return jsonOk({ source });
  } catch (error) {
    return jsonError(error, "PUT /api/admin/knowledge/sources");
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id || !isUuid(id)) throw new ValidationError("Invalid knowledge source id");
    await adminDeleteKnowledgeSource(user.profile.role, id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/admin/knowledge/sources");
  }
}
