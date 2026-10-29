import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { COMMISSION_DATE_SOURCES, GROSS_PROFIT_BASES } from "@/lib/reports/commissions";
import { requireReportsContext } from "@/lib/reports/http";
import {
  needForRuleSet,
  requireRulePermission,
  runRateOperation,
  runRuleSetOperation,
} from "@/lib/reports/rule-operations";
import {
  assignProject,
  removeAssignment,
  requireRuleSet,
  updateRuleSetConfig,
} from "@/lib/reports/rules";
import { actorOf, assertCanViewRules, callerOf, ruleSetDetail } from "@/lib/reports/rules-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

const reportIdParam = (request: Request) => {
  const id = new URL(request.url).searchParams.get("reportId");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    assertCanViewRules(ctx);
    const { key } = await params;
    return jsonOk(await ruleSetDetail(ctx, await requireRuleSet(key), reportIdParam(request)));
  } catch (error) {
    return jsonError(error, "GET /api/reports/rules/[key]");
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const reason = z.string().trim().min(3, "Give a reason (a few words).").max(400);
const lifecycle = {
  dryRun: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
};
const rateRef = {
  ...lifecycle,
  rateId: z.string().uuid(),
  reason,
  expectedVersion: z.number().int().positive().optional(),
};
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_rate"),
    ...lifecycle,
    salesperson: z.string().trim().min(1).max(80),
    ratePct: z.number().min(0).max(100),
    effectiveFrom: date,
    jobId: z.string().max(40).nullable().optional(),
    note: z.string().max(400).optional(),
  }),
  z.object({ action: z.literal("end_rate"), ...rateRef, endDate: date }),
  z.object({ action: z.literal("void_rate"), ...rateRef }),
  z.object({
    action: z.literal("correct_rate"),
    ...rateRef,
    changes: z
      .object({
        ratePct: z.number().min(0).max(100).optional(),
        effectiveFrom: date.optional(),
        effectiveTo: date.nullable().optional(),
        jobId: z.string().max(40).nullable().optional(),
      })
      .refine((c) => Object.keys(c).length > 0, "Say what to correct."),
  }),
  z.object({ action: z.literal("restore_rate"), ...rateRef }),
  z.object({
    action: z.literal("delete_rate"),
    ...rateRef,
    confirm: z.string().max(10).optional(),
  }),
  z.object({
    action: z.literal("archive"),
    ...lifecycle,
    reason,
    expectedVersion: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("restore_rules"),
    ...lifecycle,
    reason,
    expectedVersion: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("set_scope"),
    ...lifecycle,
    scope: z.enum(["dashboard", "company", "template"]),
    reason,
    expectedVersion: z.number().int().positive().optional(),
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

/**
 * Change rates, assignments, calculation settings, or the rule set's lifecycle. Every change
 * is authorized server-side and audited; lifecycle actions accept `dryRun` (impact preview,
 * nothing saved) and an `idempotencyKey`.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    assertCanViewRules(ctx);
    const { key } = await params;
    const rs = await requireRuleSet(key);
    const body = actionSchema.parse(await request.json());
    const caller = callerOf(ctx);
    const reportId = reportIdParam(request);
    const { action } = body;
    let outcome: unknown = null;
    if (
      action === "set_rate" ||
      action === "end_rate" ||
      action === "void_rate" ||
      action === "correct_rate" ||
      action === "restore_rate" ||
      action === "delete_rate"
    ) {
      const { dryRun, idempotencyKey, ...rest } = body;
      const op = { ...rest, type: action } as unknown as Parameters<
        typeof runRateOperation
      >[0]["op"];
      const res = await runRateOperation({
        caller,
        ruleSetKey: rs.key,
        op,
        dryRun,
        idempotencyKey,
      });
      if (res.dryRun) return jsonOk({ preview: res.preview });
      outcome = { preview: res.preview, replayed: res.replayed };
    } else if (action === "archive" || action === "restore_rules" || action === "set_scope") {
      const { dryRun, idempotencyKey, ...rest } = body;
      const op = {
        ...rest,
        type: action === "restore_rules" ? "restore" : action,
      } as unknown as Parameters<typeof runRuleSetOperation>[0]["op"];
      const res = await runRuleSetOperation({
        caller,
        ruleSetKey: rs.key,
        op,
        dryRun,
        idempotencyKey,
      });
      if (res.dryRun) return jsonOk({ preview: res.preview });
      outcome = { preview: res.preview, replayed: res.replayed };
    } else {
      requireRulePermission(caller, needForRuleSet(rs), "Changing these rules");
      const actor = actorOf(ctx);
      if (body.action === "assign") {
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
        await updateRuleSetConfig(rs, body.config, actor, {
          confirm: body.confirm,
          note: body.note,
        });
      }
    }
    return jsonOk({
      ...(await ruleSetDetail(ctx, await requireRuleSet(rs.key), reportId)),
      outcome,
    });
  } catch (error) {
    return jsonError(error, "POST /api/reports/rules/[key]");
  }
}
