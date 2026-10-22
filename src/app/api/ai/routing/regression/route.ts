import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { runRoutingRegression } from "@/lib/agents/testing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Replays every specialist's example requests through the router and reports mismatches. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const body = z
      .object({
        useAi: z.boolean().default(false),
        useDraftFor: z.string().max(80).nullable().optional(),
      })
      .parse(await request.json().catch(() => ({})));
    const report = await runRoutingRegression({
      useAi: body.useAi,
      draftOverrideFor: body.useDraftFor ?? null,
    });
    await recordAudit({
      actor: actorOf(ctx),
      action: "routing.regression_run",
      targetType: "workspace",
      targetId: "routing",
      summary: `Routing regression: ${report.passed}/${report.total} passed (${body.useAi ? "AI" : "rules"}).`,
    });
    return jsonOk({ report });
  } catch (error) {
    return jsonError(error, "POST /api/ai/routing/regression");
  }
}
