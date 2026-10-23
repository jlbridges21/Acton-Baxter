/** Shared authorization + view helpers for /api/reports/rules/* (server only). */

import "server-only";

import { AuthorizationError } from "@/lib/errors";
import { CATEGORY_LABELS } from "./access";
import { BASIS_LABELS, DATE_SOURCE_LABELS } from "./commissions";
import { asList } from "./compute";
import { loadSourceRows } from "./engine";
import { resolveField } from "./fields";
import type { ReportsContext } from "./http";
import {
  listAssignments,
  listRates,
  listRuleChanges,
  type RuleActor,
  type RuleSetRow,
} from "./rules";

export function assertCanViewRules(ctx: ReportsContext) {
  if (!ctx.access.categories.has("financial")) {
    throw new AuthorizationError(
      `Commission rules include compensation data and require "${CATEGORY_LABELS.financial}" access.`,
    );
  }
}

export function assertCanEditRules(ctx: ReportsContext) {
  assertCanViewRules(ctx);
  if (!ctx.access.canEditRules) {
    throw new AuthorizationError(
      'Changing rates and assignments needs "Edit business rules (Reports)" access. Ask an administrator.',
    );
  }
}

export const actorOf = (ctx: ReportsContext): RuleActor => ({
  userId: ctx.user.id,
  label: ctx.requester.label,
});

/** Everything the rate and assignment editors need, with project names resolved. */
export async function ruleSetDetail(ctx: ReportsContext, rs: RuleSetRow) {
  const [{ rows, catalog }, rates, assignments, history] = await Promise.all([
    loadSourceRows("jobs"),
    listRates(rs.id),
    listAssignments(rs.id),
    listRuleChanges(rs.id, 50),
  ]);
  const rep = resolveField(catalog, "sem:sales_rep");
  const repKey = rep.ok ? rep.key : null;
  const phase = resolveField(catalog, "sem:phase");
  const phaseKey = phase.ok ? phase.key : null;
  const jobName = new Map(
    rows.map((r) => [r.id, `${r["job.number"] ? `${r["job.number"]} · ` : ""}${r["job.name"]}`]),
  );
  const salespeople = [
    ...new Set([
      ...rs.config.salespeople,
      ...(rep.ok ? (rep.def.options ?? []) : []),
      ...rates.map((r) => r.salesperson),
      ...assignments.map((a) => a.salesperson),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  return {
    key: rs.key,
    name: rs.name,
    description: rs.description,
    config: rs.config,
    options: {
      basis: Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label })),
      dateSource: Object.entries(DATE_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
    },
    canEdit: ctx.access.canEditRules,
    salespeople,
    rates: rates.map((r) => ({
      id: r.id,
      salesperson: r.salesperson,
      jobId: r.job_id,
      jobName: r.job_id ? (jobName.get(r.job_id) ?? r.job_id) : null,
      ratePct: Number(r.rate_pct),
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      note: r.note,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      jobId: a.job_id,
      jobName: jobName.get(a.job_id) ?? a.job_id,
      salesperson: a.salesperson,
      splitPct: Number(a.split_pct),
      paymentDate: a.payment_date,
      note: a.note,
    })),
    projects: rows
      .map((r) => ({
        id: r.id,
        name: jobName.get(r.id) ?? r.id,
        salesRep: repKey ? asList(r[repKey]) : [],
        phase: phaseKey ? (asList(r[phaseKey])[0] ?? null) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    history: history.map((h) => ({
      id: h.id,
      when: h.created_at,
      who: h.changed_by_label,
      entity: h.entity,
      action: h.action,
      note: h.note,
    })),
  };
}
