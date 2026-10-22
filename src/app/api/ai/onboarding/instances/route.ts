import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, assertOnboardingAccess, requireAiContext } from "@/lib/agents/http";
import {
  createInstance,
  getInstance,
  instanceInputSchema,
  listInstances,
  summarizeProgress,
} from "@/lib/agents/onboarding";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAiContext();
    const access = await assertOnboardingAccess(ctx.requester, "view_activity");
    const instances = await listInstances();
    const withProgress = await Promise.all(
      instances.map(async (instance) => {
        const { steps } = await getInstance(instance.id);
        const p = summarizeProgress(steps);
        return {
          ...instance,
          progress: {
            total: p.total,
            done: p.done,
            percent: p.percent,
            overdue: p.overdue.length,
            next: p.nextSteps[0]?.title ?? null,
          },
        };
      }),
    );
    return jsonOk({ instances: withProgress, canRun: access.has("approve") });
  } catch (error) {
    return jsonError(error, "GET /api/ai/onboarding/instances");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    await assertOnboardingAccess(ctx.requester, "approve");
    const input = instanceInputSchema.parse(await request.json());
    const instance = await createInstance(input, ctx.user.id);
    await recordAudit({
      actor: actorOf(ctx),
      action: "onboarding.started",
      targetType: "onboarding_instance",
      targetId: instance.id,
      summary: `Started onboarding from "${instance.template_name}".`,
    });
    return jsonOk({ instance }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ai/onboarding/instances");
  }
}
