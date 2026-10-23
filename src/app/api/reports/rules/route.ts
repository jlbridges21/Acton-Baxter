import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { createRuleSet, listRuleSets } from "@/lib/reports/rules";
import { actorOf, assertCanEditRules, assertCanViewRules } from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireReportsContext();
    assertCanViewRules(ctx);
    const sets = await listRuleSets();
    return jsonOk({
      ruleSets: sets.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        kind: s.kind,
        updatedAt: s.updated_at,
      })),
      canEdit: ctx.access.canEditRules,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/rules");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(600).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    assertCanEditRules(ctx);
    const body = createSchema.parse(await request.json());
    const row = await createRuleSet({
      name: body.name,
      description: body.description,
      actor: actorOf(ctx),
    });
    return jsonOk({ key: row.key }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/reports/rules");
  }
}
