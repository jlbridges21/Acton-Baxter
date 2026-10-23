import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { chatProgress } from "@/lib/reports/chat";
import { requireReportsContext } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

/** Polled by the chat panel while Dexter works (the caller's own requests only). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    if (requestId.length < 8 || requestId.length > 80)
      throw new ValidationError("Missing requestId");
    return jsonOk(await chatProgress(ctx.user.id, requestId));
  } catch (error) {
    return jsonError(error, "GET /api/reports/chat/progress");
  }
}
