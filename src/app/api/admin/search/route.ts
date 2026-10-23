import { jsonError, jsonOk } from "@/lib/api";
import { getSearchAdminOverview, runSearchAdminCommand } from "@/lib/search/admin";
import { requireSearchAdminContext } from "@/lib/search/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    await requireSearchAdminContext();
    return jsonOk(await getSearchAdminOverview(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error, "GET /api/admin/search");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSearchAdminContext();
    return jsonOk(await runSearchAdminCommand(ctx, await request.json()));
  } catch (error) {
    return jsonError(error, "POST /api/admin/search");
  }
}
