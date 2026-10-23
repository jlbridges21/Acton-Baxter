import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { getBambooAccess } from "@/lib/bamboohr/access";
import { searchEmployees } from "@/lib/bamboohr/views";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Search BambooHR employees (CEO, COO, HR administrators only). Names and job titles only. */
export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    if (!checkRateLimit(`bamboohr-search:${ctx.user.id}`, { limit: 60, windowMs: 60_000 }).allowed)
      throw new AppError("Too many searches. Wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    const access = await getBambooAccess(ctx.requester);
    const url = new URL(request.url);
    return jsonOk(
      await searchEmployees(
        access,
        (url.searchParams.get("q") ?? "").slice(0, 60),
        url.searchParams.get("after"),
      ),
    );
  } catch (error) {
    return jsonError(error, "GET /api/integrations/bamboohr/employees");
  }
}
