import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { requireRulePermission } from "@/lib/reports/rule-operations";
import { createRuleSet, listRuleSets } from "@/lib/reports/rules";
import { actorOf, assertCanViewRules, callerOf } from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireReportsContext();
    assertCanViewRules(ctx);
    const sets = await listRuleSets();
    return jsonOk({
      ruleSets: sets
        .filter((s) => s.status !== "copying")
        .map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          description: s.description,
          kind: s.kind,
          scope: s.scope,
          status: s.status,
          needsReview: s.needs_review,
          ownerReportId: s.owner_report_id,
          updatedAt: s.updated_at,
        })),
      canEdit: ctx.access.canEditRules,
      canAdmin: ctx.access.isAdmin,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/rules");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(600).optional(),
  /** Company and template rule sets are shared by design: administrators only. */
  scope: z.enum(["dashboard", "company", "template"]).default("dashboard"),
});

/** Create an empty rule set. Dashboard sets are claimed by the first report that uses them. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = createSchema.parse(await request.json());
    requireRulePermission(
      callerOf(ctx),
      body.scope === "dashboard" ? "edit_rules" : "admin",
      `Creating a ${body.scope} rule set`,
    );
    const row = await createRuleSet({
      name: body.name,
      description: body.description,
      scope: body.scope,
      actor: actorOf(ctx),
    });
    return jsonOk({ key: row.key, id: row.id, scope: row.scope }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/reports/rules");
  }
}
