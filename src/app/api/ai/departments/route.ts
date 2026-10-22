import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { upsertDepartment } from "@/lib/agents/admin";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { getDepartmentRows } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAiContext();
    return jsonOk({ departments: await getDepartmentRows() });
  } catch (error) {
    return jsonError(error, "GET /api/ai/departments");
  }
}

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a color.")
    .default("#1e3a5f"),
  is_visible: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const department = await upsertDepartment(schema.parse(await request.json()), actorOf(ctx));
    return jsonOk({ department });
  } catch (error) {
    return jsonError(error, "POST /api/ai/departments");
  }
}
