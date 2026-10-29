/** Shared authorization + view helpers for /api/reports/rules/* (server only). */

import "server-only";

import { AuthorizationError } from "@/lib/errors";
import { CATEGORY_LABELS } from "./access";
import { BASIS_LABELS, DATE_SOURCE_LABELS } from "./commissions";
import { asList } from "./compute";
import { loadSourceRows } from "./engine";
import { resolveField } from "./fields";
import type { ReportsContext } from "./http";
import { BINDING_MODE_LABELS, listBindingsForReport, listConsumers } from "./rule-bindings";
import { needForRuleSet, publicRate, type RuleCaller } from "./rule-operations";
import {
  getRuleSetById,
  listAssignments,
  listRates,
  listRuleChanges,
  rateState,
  ruleActor,
  todayIso,
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

export const actorOf = (ctx: ReportsContext): RuleActor =>
  ruleActor(ctx.requester.label, ctx.user.id, "ui");

export const callerOf = (ctx: ReportsContext): RuleCaller => ({
  access: ctx.access,
  requester: ctx.requester,
  via: "ui",
});

/** Can this person change this rule set? Company and template sets: administrators only. */
export function canEditRuleSet(ctx: ReportsContext, rs: RuleSetRow): boolean {
  if (rs.status !== "active" || !ctx.access.canEditRules) return false;
  return needForRuleSet(rs) === "admin" ? ctx.access.isAdmin : true;
}

/**
 * Everything the rate and assignment editors need, with project names resolved: identity,
 * scope, owner, consumers, how it is attached to `reportId`, rate states, and history.
 */
export async function ruleSetDetail(ctx: ReportsContext, rs: RuleSetRow, reportId?: string | null) {
  const [{ rows, catalog }, rates, assignments, history, consumers, bindings, copiedFrom] =
    await Promise.all([
      loadSourceRows("jobs"),
      listRates(rs.id, { includeInactive: true }),
      listAssignments(rs.id),
      listRuleChanges(rs.id, 50),
      listConsumers(rs),
      reportId ? listBindingsForReport(reportId) : Promise.resolve([]),
      rs.copied_from_rule_set_id
        ? getRuleSetById(rs.copied_from_rule_set_id)
        : Promise.resolve(null),
    ]);
  const binding = bindings.find((b) => b.rule_set_id === rs.id);
  const liveConsumers = consumers.filter((c) => !c.isTemplate);
  const owner = rs.owner_report_id
    ? consumers.find((c) => c.reportId === rs.owner_report_id)
    : null;
  const today = todayIso();
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
    id: rs.id,
    key: rs.key,
    name: rs.name,
    description: rs.description,
    scope: rs.scope,
    status: rs.status,
    version: rs.version,
    needsReview: rs.needs_review,
    reviewNote: rs.review_note,
    archivedAt: rs.archived_at,
    archiveReason: rs.archive_reason,
    owner: {
      reportId: rs.owner_report_id,
      reportTitle: owner?.title ?? null,
      createdBy: rs.created_by,
    },
    copiedFrom: copiedFrom ? { key: copiedFrom.key, name: copiedFrom.name } : null,
    consumers: {
      total: liveConsumers.length,
      others: liveConsumers.filter((c) => c.reportId !== reportId).length,
      templates: consumers.length - liveConsumers.length,
      reports: liveConsumers.map((c) => ({
        reportId: c.reportId,
        title: c.title,
        mode: c.mode,
        attachedAs: c.mode ? BINDING_MODE_LABELS[c.mode] : "Not recorded (legacy)",
      })),
    },
    attachment: reportId
      ? {
          mode: binding?.mode ?? null,
          label: binding ? BINDING_MODE_LABELS[binding.mode] : "Not recorded (legacy)",
          at: binding?.attached_at ?? null,
          by: binding?.attached_by_label ?? null,
          needsReview: binding?.needs_review ?? true,
        }
      : null,
    lastChange: history[0]
      ? {
          when: history[0].created_at,
          who: history[0].changed_by_label,
          action: `${history[0].entity} ${history[0].action}`,
        }
      : null,
    config: rs.config,
    options: {
      basis: Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label })),
      dateSource: Object.entries(DATE_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
    },
    canEdit: canEditRuleSet(ctx, rs),
    canAdmin: ctx.access.isAdmin,
    /** May make report-level choices (start empty / copy / attach) on reports they can edit. */
    canEditRules: ctx.access.canEditRules,
    editBlockedBecause:
      rs.status !== "active"
        ? `These rules are ${rs.status}.`
        : !ctx.access.canEditRules
          ? 'Changing rates and assignments needs "Edit business rules (Reports)" access. Ask an administrator.'
          : !canEditRuleSet(ctx, rs)
            ? `This is a ${rs.scope} rule set${liveConsumers.length > 1 ? ` used by ${liveConsumers.length} reports` : ""}; only an administrator can change it. Copy it into this dashboard to edit your own.`
            : null,
    salespeople,
    rates: rates.map((r) => ({
      ...publicRate(r),
      jobName: r.job_id ? (jobName.get(r.job_id) ?? r.job_id) : null,
      note: r.note,
      state: rateState(r, today),
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
      reason: h.reason ?? null,
      commissionsAffected: h.commissions_affected ?? null,
    })),
  };
}
