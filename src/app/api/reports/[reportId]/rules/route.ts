import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { reportRuleImpact } from "@/lib/reports/rule-bindings";
import { reportRules, runReportRulesOperation } from "@/lib/reports/rule-operations";
import { callerOf } from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

/** The report's rule sets (how each is attached, who else uses it) and what deleting would do. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const rules = await reportRules(callerOf(ctx), reportId);
    return jsonOk({ ...rules, deleteImpact: await reportRuleImpact({ id: reportId }) });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/rules");
  }
}

const common = {
  dryRun: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  expectedVersion: z.number().int().positive().optional(),
};
const key = z.string().trim().min(2).max(60);
const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_empty"), ...common, replaceKey: key.optional() }),
  z.object({ type: z.literal("copy"), ...common, fromKey: key, replaceKey: key.optional() }),
  z.object({
    type: z.literal("attach"),
    ...common,
    key,
    confirmShared: z.boolean().default(false),
    replaceKey: key.optional(),
  }),
  z.object({
    type: z.literal("detach"),
    ...common,
    key,
    reason: z.string().trim().min(3, "Give a reason (a few words).").max(400),
  }),
]);

/** Deliberate rule choices for this dashboard: start empty, copy, attach shared, detach. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { dryRun, idempotencyKey, expectedVersion, ...op } = bodySchema.parse(
      await request.json(),
    );
    return jsonOk(
      await runReportRulesOperation({
        caller: callerOf(ctx),
        reportId,
        op,
        dryRun,
        idempotencyKey,
        expectedVersion,
      }),
    );
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/rules");
  }
}
