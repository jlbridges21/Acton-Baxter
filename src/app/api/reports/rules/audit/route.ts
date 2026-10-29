import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { auditRuleSets } from "@/lib/reports/rule-bindings";
import { requireRulePermission } from "@/lib/reports/rule-operations";
import { callerOf } from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

/**
 * Read-only audit of every rule set: consumers (bound and legacy references), templates that
 * still name one, orphans, and what needs an administrator's review. Changes nothing.
 */
export async function GET() {
  try {
    const ctx = await requireReportsContext();
    requireRulePermission(callerOf(ctx), "edit_rules", "The business-rules audit");
    const entries = await auditRuleSets();
    return jsonOk({
      generatedAt: new Date().toISOString(),
      summary: {
        ruleSets: entries.length,
        needsReview: entries.filter((e) => e.needsReview).length,
        orphaned: entries.filter((e) => e.orphaned).length,
        legacy: entries.filter((e) => e.legacy).length,
        sharedWithoutChoice: entries.filter(
          (e) => e.needsReview && e.consumers.filter((c) => !c.isTemplate).length > 1,
        ).length,
      },
      ruleSets: entries,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/rules/audit");
  }
}
