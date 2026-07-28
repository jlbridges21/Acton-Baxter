import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireActiveUser();
    const { id } = await context.params;
    const record = await getPemNeatStore().get(id);
    if (!record) {
      throw new NotFoundError("PEM NEAT not found");
    }
    return jsonOk({ item: record });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats/[id]");
  }
}
