import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError } from "@/lib/errors";
import { requireAiContext } from "@/lib/agents/http";
import { loadProfileSafe } from "@/lib/agents/profiles";
import { canAdministerWorkspace, getAgentAccess } from "@/lib/agents/permissions";
import { listResolvedAgents } from "@/lib/agents/registry";
import { testRouting } from "@/lib/agents/testing";
import type { Requester } from "@/lib/agents/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  expectedSlug: z.string().max(80).nullable().optional(),
  useAi: z.boolean().default(true),
  /** Simulate authorization for a role ("user") or a specific person (profile id). */
  simulateRole: z.enum(["user", "admin"]).nullable().optional(),
  simulateUserId: z.string().uuid().nullable().optional(),
  useDraftFor: z.string().max(80).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const agents = await listResolvedAgents();
    const managesAny = (
      await Promise.all(agents.map((a) => getAgentAccess(ctx.requester, a)))
    ).some((s) => s.has("manage"));
    if (!canAdministerWorkspace(ctx.requester) && !managesAny) {
      throw new AuthorizationError("Only agent managers can use the delegation tester.");
    }
    const body = bodySchema.parse(await request.json());
    let simulateAs: Requester | null = null;
    if (body.simulateUserId) {
      const profile = await loadProfileSafe(body.simulateUserId);
      simulateAs = profile
        ? {
            userId: profile.id,
            role: profile.role,
            departmentId: profile.department_id ?? null,
            label: profile.full_name,
            verifiedVia: "web_session",
          }
        : null;
    } else if (body.simulateRole) {
      simulateAs = {
        userId: "00000000-0000-4000-8000-000000000000",
        role: body.simulateRole,
        departmentId: null,
        label: body.simulateRole === "admin" ? "An administrator" : "A typical employee",
        verifiedVia: "web_session",
      };
    }
    const result = await testRouting({
      question: body.question,
      expectedSlug: body.expectedSlug ?? null,
      simulateAs,
      useAi: body.useAi,
      draftOverrideFor: body.useDraftFor ?? null,
    });
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error, "POST /api/ai/routing/test");
  }
}
