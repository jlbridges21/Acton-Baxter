import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError } from "@/lib/errors";
import { getConfigState, publishProblems, updateAgentIdentity } from "@/lib/agents/admin";
import { listAudit } from "@/lib/agents/audit";
import { actorOf, requireAgent, requireAiContext } from "@/lib/agents/http";
import { getProviderStatuses, MODEL_CATALOG } from "@/lib/agents/models";
import {
  canAdministerWorkspace,
  getAgentAccess,
  loadAccessPolicies,
} from "@/lib/agents/permissions";
import { PROTECTED_SYSTEM_RULES } from "@/lib/agents/security-policy";
import { TOOL_REGISTRY } from "@/lib/agents/tools";
import { listAgentCards } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgent(slug);
    const access = await getAgentAccess(ctx.requester, agent);
    const card = (await listAgentCards(ctx.requester, { includeArchived: true })).find(
      (c) => c.id === agent.row.id,
    )!;
    const canReadConfig = access.has("manage") || access.has("view_activity");
    const isAdmin = canAdministerWorkspace(ctx.requester);
    const config = canReadConfig ? await getConfigState(agent.row.id) : null;
    return jsonOk({
      agent: card,
      access: [...access],
      isAdmin,
      config: config
        ? {
            published: config.published,
            draft: config.draft,
            draftProblems: config.draft ? publishProblems(agent.row, config.draft.parsed) : [],
            history: config.history.map((v) => ({
              id: v.id,
              version_number: v.version_number,
              status: v.status,
              change_summary: v.change_summary,
              created_at: v.created_at,
              published_at: v.published_at,
            })),
          }
        : null,
      protectedRules: canReadConfig ? PROTECTED_SYSTEM_RULES : null,
      tools: TOOL_REGISTRY.map((t) => ({
        key: t.key,
        label: t.label,
        description: t.description,
        risk: t.risk,
        alwaysRequiresApproval: t.alwaysRequiresApproval,
        available: t.available,
        unavailableReason: t.unavailableReason ?? null,
      })),
      models: MODEL_CATALOG,
      providers: getProviderStatuses(),
      policies: isAdmin ? await loadAccessPolicies(agent.row.id) : null,
      audit: access.has("manage")
        ? await listAudit({ targetType: "agent", targetId: agent.row.id, limit: 30 })
        : [],
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/agents/[slug]");
  }
}

const patchSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  department_id: z.string().uuid().nullable().optional(),
  manager_agent_id: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  status_label: z.string().trim().max(60).nullable().optional(),
  desk: z
    .object({
      area: z.string().max(80).optional(),
      slot: z.number().int().min(0).max(20).optional(),
    })
    .optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgent(slug);
    const access = await getAgentAccess(ctx.requester, agent);
    if (!access.has("manage")) throw new AuthorizationError("You can't edit this agent.");
    const patch = patchSchema.parse(await request.json());
    const structural =
      patch.status !== undefined ||
      patch.manager_agent_id !== undefined ||
      patch.department_id !== undefined;
    if (structural && !canAdministerWorkspace(ctx.requester)) {
      throw new AuthorizationError(
        "Only administrators can change an agent's status, department, or manager.",
      );
    }
    const updated = await updateAgentIdentity(agent.row.id, patch, actorOf(ctx));
    return jsonOk({ agent: updated });
  } catch (error) {
    return jsonError(error, "PATCH /api/ai/agents/[slug]");
  }
}
