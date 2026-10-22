import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, assertOnboardingAccess, requireAiContext } from "@/lib/agents/http";
import { createTemplate, listTemplates, templateInputSchema } from "@/lib/agents/onboarding";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAiContext();
    const access = await assertOnboardingAccess(ctx.requester, "view_activity");
    return jsonOk({
      templates: await listTemplates(),
      canEdit: access.has("manage"),
      canRun: access.has("approve"),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/onboarding/templates");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    await assertOnboardingAccess(ctx.requester, "manage");
    const input = templateInputSchema.parse(await request.json());
    const template = await createTemplate(input, ctx.user.id);
    await recordAudit({
      actor: actorOf(ctx),
      action: "onboarding.template_created",
      targetType: "onboarding_template",
      targetId: template.id,
      summary: `Created template "${template.name}".`,
    });
    return jsonOk({ template }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ai/onboarding/templates");
  }
}
