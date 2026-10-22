import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, assertOnboardingAccess, requireAiContext } from "@/lib/agents/http";
import { getInstance, setInstanceStatus, summarizeProgress } from "@/lib/agents/onboarding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const access = await assertOnboardingAccess(ctx.requester, "view_activity");
    const { id } = await params;
    const { instance, steps } = await getInstance(id);
    const progress = summarizeProgress(steps);
    return jsonOk({
      instance,
      steps,
      progress: {
        ...progress,
        nextSteps: progress.nextSteps.map((s) => s.id),
        overdue: progress.overdue.map((s) => s.id),
      },
      canRun: access.has("approve"),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/onboarding/instances/[id]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    await assertOnboardingAccess(ctx.requester, "approve");
    const { id } = await params;
    const { status } = z
      .object({ status: z.enum(["active", "completed", "cancelled"]) })
      .parse(await request.json());
    await setInstanceStatus(id, status);
    await recordAudit({
      actor: actorOf(ctx),
      action: "onboarding.status_changed",
      targetType: "onboarding_instance",
      targetId: id,
      summary: `Marked onboarding ${status}.`,
    });
    return jsonOk({ status });
  } catch (error) {
    return jsonError(error, "PATCH /api/ai/onboarding/instances/[id]");
  }
}
