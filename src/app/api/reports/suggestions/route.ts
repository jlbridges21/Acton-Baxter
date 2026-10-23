import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import {
  dismissSuggestion,
  markSuggestionStarted,
  restoreSuggestion,
  visibleSuggestions,
} from "@/lib/reports/smart-suggestions";

export const dynamic = "force-dynamic";

/** Suggested reports worth showing this user (feasible, not already built, not dismissed). */
export async function GET() {
  try {
    const ctx = await requireReportsContext();
    return jsonOk({ suggestions: await visibleSuggestions(ctx.requester, ctx.access) });
  } catch (error) {
    return jsonError(error, "GET /api/reports/suggestions");
  }
}

const bodySchema = z.object({
  op: z.enum(["start", "dismiss", "restore"]),
  key: z.string().max(60),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = bodySchema.parse(await request.json());
    if (body.op === "start") await markSuggestionStarted(ctx.user.id, body.key);
    else if (body.op === "dismiss") await dismissSuggestion(ctx.user.id, body.key);
    else await restoreSuggestion(ctx.user.id, body.key);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/reports/suggestions");
  }
}
