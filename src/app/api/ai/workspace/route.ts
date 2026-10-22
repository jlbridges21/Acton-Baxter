import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/lib/agents/admin";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { getDepartmentRows } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAiContext();
    return jsonOk({
      settings: await getWorkspaceSettings(),
      departments: await getDepartmentRows(),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/workspace");
  }
}

const patchSchema = z.object({
  layout_preset: z.enum(["studio", "campus", "compact"]).optional(),
  theme: z.enum(["daylight", "evening", "blueprint"]).optional(),
  show_meeting_area: z.boolean().optional(),
  show_future_space: z.boolean().optional(),
  area_labels: z.record(z.string().max(80), z.string().trim().max(60)).optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const patch = patchSchema.parse(await request.json());
    return jsonOk({ settings: await updateWorkspaceSettings(patch, actorOf(ctx)) });
  } catch (error) {
    return jsonError(error, "PATCH /api/ai/workspace");
  }
}
