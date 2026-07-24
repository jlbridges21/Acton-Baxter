import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { listConnectorHealth } from "@/lib/connectors/registry";

export async function GET() {
  try {
    await requireAdmin();
    const connectors = await listConnectorHealth();
    return jsonOk({ connectors });
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors");
  }
}
