import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, assertOnboardingAccess, requireAiContext } from "@/lib/agents/http";
import { getTemplate, saveTemplate, templateInputSchema } from "@/lib/agents/onboarding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const access = await assertOnboardingAccess(ctx.requester, "view_activity");
    const { id } = await params;
    return jsonOk({ ...(await getTemplate(id)), canEdit: access.has("manage") });
  } catch (error) {
    return jsonError(error, "GET /api/ai/onboarding/templates/[id]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    await assertOnboardingAccess(ctx.requester, "manage");
    const { id } = await params;
    const input = templateInputSchema
      .extend({ is_placeholder: z.boolean().optional() })
      .parse(await request.json());
    const template = await saveTemplate(id, input);
    await recordAudit({
      actor: actorOf(ctx),
      action: "onboarding.template_updated",
      targetType: "onboarding_template",
      targetId: id,
      summary: `Updated template "${template.name}" (${input.steps.length} steps).`,
    });
    return jsonOk({ template });
  } catch (error) {
    return jsonError(error, "PUT /api/ai/onboarding/templates/[id]");
  }
}
