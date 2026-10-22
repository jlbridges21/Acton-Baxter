import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { createAgent } from "@/lib/agents/admin";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { listAgentCards } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAiContext();
    return jsonOk({ agents: await listAgentCards(ctx.requester) });
  } catch (error) {
    return jsonError(error, "GET /api/ai/agents");
  }
}

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  title: z.string().trim().max(120).default(""),
  description: z.string().trim().max(2000).default(""),
  departmentId: z.string().uuid().nullable(),
  managerAgentId: z.string().uuid().nullable(),
  config: z.unknown(),
  activate: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const input = createSchema.parse(await request.json());
    const agent = await createAgent({ ...input, actor: actorOf(ctx) });
    return jsonOk({ agent }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents");
  }
}
