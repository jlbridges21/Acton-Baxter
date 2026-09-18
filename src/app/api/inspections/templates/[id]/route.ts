import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getTemplate } from "@/lib/inspections";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const template = await getTemplate(id);
    return jsonOk({ template });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/templates/[id]");
  }
}
