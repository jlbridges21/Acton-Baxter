import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { z } from "zod";
import { getReportPrefs, setReportPrefs } from "@/lib/reports/prefs";

export const dynamic = "force-dynamic";

/** The signed-in user's Reports layout preferences (e.g. collapsed sections). */
export async function GET() {
  try {
    const ctx = await requireReportsContext();
    return jsonOk({ prefs: await getReportPrefs(ctx.user.id) });
  } catch (error) {
    return jsonError(error, "GET /api/reports/prefs");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const patch = z
      .object({
        suggestionsCollapsed: z.boolean().optional(),
        templatesCollapsed: z.boolean().optional(),
      })
      .strict()
      .parse(await request.json());
    return jsonOk({ prefs: await setReportPrefs(ctx.user.id, patch) });
  } catch (error) {
    return jsonError(error, "PUT /api/reports/prefs");
  }
}
