import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { assertOnboardingAccess, requireAiContext } from "@/lib/agents/http";
import { updateInstanceStep } from "@/lib/agents/onboarding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    await assertOnboardingAccess(ctx.requester, "approve");
    const { id } = await params;
    const { status } = z
      .object({ status: z.enum(["pending", "in_progress", "done", "skipped", "blocked"]) })
      .parse(await request.json());
    const step = await updateInstanceStep(id, status, ctx.user.id);
    return jsonOk({ step });
  } catch (error) {
    return jsonError(error, "PATCH /api/ai/onboarding/steps/[id]");
  }
}
