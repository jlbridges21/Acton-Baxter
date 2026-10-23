import { jsonError, jsonOk } from "@/lib/api";
import { listGroupsFor } from "@/lib/reports/groups";
import { runGroupCommand } from "@/lib/reports/groups-http";
import { requireReportsContext } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

/** Report groups visible to the signed-in user (counts include only reports they can open). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
    const { groups } = await listGroupsFor(ctx, { includeArchived });
    return jsonOk({ groups });
  } catch (error) {
    return jsonError(error, "GET /api/reports/groups");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    return jsonOk({ result: (await runGroupCommand(ctx, await request.json())) ?? null });
  } catch (error) {
    return jsonError(error, "POST /api/reports/groups");
  }
}
