import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { getBambooAccess } from "@/lib/bamboohr/access";
import { employeeView } from "@/lib/bamboohr/views";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One employee's permitted BambooHR data, each section attributed to BambooHR. "me" = your own record. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAiContext();
    if (!checkRateLimit(`bamboohr-view:${ctx.user.id}`, { limit: 60, windowMs: 60_000 }).allowed)
      throw new AppError("Too many requests. Wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    const access = await getBambooAccess(ctx.requester);
    const { id } = await params;
    const employeeId = id === "me" ? access.ownEmployeeId : id;
    if (!employeeId)
      throw new AppError("Your Baxter account isn't linked to a BambooHR employee record yet.", {
        code: "BAMBOOHR_NOT_MAPPED",
        statusCode: 404,
        expose: true,
      });
    return jsonOk(await employeeView(access, employeeId, { include: ["onboarding", "files"] }));
  } catch (error) {
    return jsonError(error, "GET /api/integrations/bamboohr/employees/[id]");
  }
}
