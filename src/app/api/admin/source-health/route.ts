import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getLiveSourceHealth, getMockSourceHealth } from "@/lib/research/source-health";

export async function GET() {
  try {
    await requireAdmin();
    const env = getEnv();
    const sources = env.ENABLE_MOCK_RESEARCH ? getMockSourceHealth() : await getLiveSourceHealth();
    return jsonOk({ sources });
  } catch (error) {
    return jsonError(error, "GET /api/admin/source-health");
  }
}
