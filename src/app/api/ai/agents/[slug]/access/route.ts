import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { addAccessPolicy, removeAccessPolicy } from "@/lib/agents/admin";
import { actorOf, requireAgent, requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace, loadAccessPolicies } from "@/lib/agents/permissions";
import { ACCESS_LEVELS } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Access changes are admin-only so nobody can grant themselves more access. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const { slug } = await params;
    const agent = await requireAgent(slug);
    return jsonOk({ policies: await loadAccessPolicies(agent.row.id) });
  } catch (error) {
    return jsonError(error, "GET /api/ai/agents/[slug]/access");
  }
}

const addSchema = z.object({
  principalType: z.enum(["role", "user", "department"]),
  principalValue: z.string().trim().min(1).max(200),
  accessLevel: z.enum(ACCESS_LEVELS),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const { slug } = await params;
    const agent = await requireAgent(slug);
    const input = addSchema.parse(await request.json());
    if (
      input.principalType === "role" &&
      !["user", "admin", "super_admin"].includes(input.principalValue)
    ) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["principalValue"],
          message: "Unknown role.",
          input: input.principalValue,
        },
      ]);
    }
    await addAccessPolicy({ agentId: agent.row.id, ...input, actor: actorOf(ctx) });
    return jsonOk({ policies: await loadAccessPolicies(agent.row.id) });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/access");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const { slug } = await params;
    const agent = await requireAgent(slug);
    const { policyId } = z.object({ policyId: z.string().uuid() }).parse(await request.json());
    const policies = await loadAccessPolicies(agent.row.id);
    if (policies.some((p) => p.id === policyId)) await removeAccessPolicy(policyId, actorOf(ctx));
    return jsonOk({ policies: await loadAccessPolicies(agent.row.id) });
  } catch (error) {
    return jsonError(error, "DELETE /api/ai/agents/[slug]/access");
  }
}
