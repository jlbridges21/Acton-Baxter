import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { COMMISSION_DATE_SOURCES, GROSS_PROFIT_BASES } from "@/lib/reports/commissions";
import { requireReportsContext } from "@/lib/reports/http";
import {
  assignProject,
  removeAssignment,
  requireRuleSet,
  setRate,
  updateRuleSetConfig,
} from "@/lib/reports/rules";
import {
  actorOf,
  assertCanEditRules,
  assertCanViewRules,
  ruleSetDetail,
} from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    assertCanViewRules(ctx);
    const { key } = await params;
    return jsonOk(await ruleSetDetail(ctx, await requireRuleSet(key)));
  } catch (error) {
    return jsonError(error, "GET /api/reports/rules/[key]");
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_rate"),
    salesperson: z.string().trim().min(1).max(80),
    ratePct: z.number().min(0).max(100),
    effectiveFrom: date,
    jobId: z.string().max(40).nullable().optional(),
    note: z.string().max(400).optional(),
  }),
  z.object({
    action: z.literal("assign"),
    jobId: z.string().trim().min(6).max(40),
    salesperson: z.string().trim().min(1).max(80),
    splitPct: z.number().min(1).max(100).optional(),
    paymentDate: date.nullable().optional(),
    note: z.string().max(400).optional(),
  }),
  z.object({ action: z.literal("unassign"), assignmentId: z.string().uuid() }),
  z.object({
    action: z.literal("configure"),
    config: z
      .object({
        basis: z.enum(GROSS_PROFIT_BASES),
        dateSource: z.enum(COMMISSION_DATE_SOURCES),
        useJobTreadSalesRep: z.boolean(),
        negativeGrossProfit: z.enum(["zero", "include"]),
        salespeople: z.array(z.string().trim().min(1).max(80)).max(50),
      })
      .partial(),
    confirm: z.boolean().optional(),
    note: z.string().max(400).optional(),
  }),
]);

/** Change rates, assignments, or calculation settings. Every change is audited. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    assertCanEditRules(ctx);
    const { key } = await params;
    const rs = await requireRuleSet(key);
    const body = actionSchema.parse(await request.json());
    const actor = actorOf(ctx);
    if (body.action === "set_rate") {
      await setRate({
        ruleSet: rs,
        salesperson: body.salesperson,
        ratePct: body.ratePct,
        effectiveFrom: body.effectiveFrom,
        jobId: body.jobId ?? null,
        note: body.note,
        actor,
      });
    } else if (body.action === "assign") {
      await assignProject({
        ruleSet: rs,
        jobId: body.jobId,
        salesperson: body.salesperson,
        splitPct: body.splitPct,
        paymentDate: body.paymentDate,
        note: body.note,
        actor,
      });
    } else if (body.action === "unassign") {
      await removeAssignment(rs, body.assignmentId, actor);
    } else {
      await updateRuleSetConfig(rs, body.config, actor, { confirm: body.confirm, note: body.note });
    }
    return jsonOk(await ruleSetDetail(ctx, await requireRuleSet(key)));
  } catch (error) {
    return jsonError(error, "POST /api/reports/rules/[key]");
  }
}
