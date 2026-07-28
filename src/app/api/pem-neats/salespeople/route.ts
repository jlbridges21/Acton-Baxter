import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { listSalespeople } from "@/lib/pem-neat/salespeople";

export async function GET() {
  try {
    await requireActiveUser();
    const salespeople = await listSalespeople();
    return jsonOk({ salespeople });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats/salespeople");
  }
}
