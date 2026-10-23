/**
 * Business rules configured in Baxter (not JobTread): commission rule sets, rates, and project
 * assignments. Every change is recorded in bi_rule_changes with before/after values.
 *
 * Rates are effective-dated. Setting a new rate closes the previous open rate the day before,
 * so commissions for earlier dates keep using the rate that applied then.
 */

import "server-only";

import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import {
  COMMISSION_DATE_SOURCES,
  DEFAULT_COMMISSION_CONFIG,
  GROSS_PROFIT_BASES,
  type AssignmentRow,
  type CommissionConfig,
  type RateRow,
} from "./commissions";

export const commissionConfigSchema = z.object({
  basis: z.enum(GROSS_PROFIT_BASES),
  dateSource: z.enum(COMMISSION_DATE_SOURCES),
  useJobTreadSalesRep: z.boolean(),
  negativeGrossProfit: z.enum(["zero", "include"]),
  salespeople: z.array(z.string().trim().min(1).max(80)).max(50),
});

export type RuleSetRow = {
  id: string;
  key: string;
  kind: "commission";
  name: string;
  description: string;
  config: CommissionConfig & { confirmedAt?: string | null; confirmedBy?: string | null };
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredRate = RateRow & {
  id: string;
  rule_set_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};
export type StoredAssignment = AssignmentRow & {
  id: string;
  rule_set_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  removed_at: string | null;
};
export type RuleChangeRow = {
  id: string;
  rule_set_id: string;
  entity: "rule_set" | "rate" | "assignment";
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  changed_by: string | null;
  changed_by_label: string | null;
  created_at: string;
};

export type RuleActor = { userId: string | null; label: string };

async function recordChange(
  input: Omit<RuleChangeRow, "id" | "created_at" | "changed_by" | "changed_by_label"> & {
    actor: RuleActor;
  },
) {
  const { actor, ...rest } = input;
  await agentDb().insert("bi_rule_changes", {
    ...rest,
    changed_by: actor.userId,
    changed_by_label: actor.label,
  });
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "rules"
  ).replace(/^[^a-z]/, "r");
}

export async function listRuleSets(): Promise<RuleSetRow[]> {
  return agentDb().select<RuleSetRow>("bi_rule_sets", { order: { col: "created_at" } });
}

export async function getRuleSet(key: string): Promise<RuleSetRow | null> {
  return selectOne<RuleSetRow>("bi_rule_sets", { filters: [eq("key", key)] });
}

export async function requireRuleSet(key: string): Promise<RuleSetRow> {
  const row = await getRuleSet(key);
  if (!row) throw new NotFoundError(`Business rules "${key}" not found.`);
  return row;
}

export async function createRuleSet(input: {
  name: string;
  description?: string;
  config?: Partial<CommissionConfig>;
  actor: RuleActor;
  key?: string;
}): Promise<RuleSetRow> {
  const config = commissionConfigSchema.parse({
    ...DEFAULT_COMMISSION_CONFIG,
    ...(input.config ?? {}),
  });
  let key = input.key ?? slugify(input.name);
  for (let i = 2; await getRuleSet(key); i++) key = `${slugify(input.name).slice(0, 45)}_${i}`;
  const [row] = await agentDb().insert<RuleSetRow>("bi_rule_sets", {
    key,
    kind: "commission",
    name: input.name.trim().slice(0, 120),
    description: (input.description ?? "").slice(0, 600),
    config: { ...config, confirmedAt: null, confirmedBy: null },
    created_by: input.actor.userId,
  });
  await recordChange({
    rule_set_id: row!.id,
    entity: "rule_set",
    entity_id: row!.id,
    action: "created",
    before: null,
    after: row!.config,
    note: null,
    actor: input.actor,
  });
  return row!;
}

/** Change calculation settings. `confirm` records that a person approved the rules. */
export async function updateRuleSetConfig(
  ruleSet: RuleSetRow,
  patch: Partial<CommissionConfig>,
  actor: RuleActor,
  options: { confirm?: boolean; note?: string } = {},
) {
  const { confirmedAt: _a, confirmedBy: _b, ...current } = ruleSet.config;
  void _a;
  void _b;
  const next = commissionConfigSchema.parse({ ...DEFAULT_COMMISSION_CONFIG, ...current, ...patch });
  const config = {
    ...next,
    confirmedAt: options.confirm ? new Date().toISOString() : (ruleSet.config.confirmedAt ?? null),
    confirmedBy: options.confirm ? actor.label : (ruleSet.config.confirmedBy ?? null),
  };
  const [updated] = await agentDb().update<RuleSetRow>("bi_rule_sets", [eq("id", ruleSet.id)], {
    config,
  });
  await recordChange({
    rule_set_id: ruleSet.id,
    entity: "rule_set",
    entity_id: ruleSet.id,
    action: options.confirm ? "confirmed" : "config_changed",
    before: ruleSet.config,
    after: config,
    note: options.note ?? null,
    actor,
  });
  return updated!;
}

export async function listRates(ruleSetId: string): Promise<StoredRate[]> {
  return agentDb().select<StoredRate>("bi_commission_rates", {
    filters: [eq("rule_set_id", ruleSetId)],
    order: { col: "effective_from" },
  });
}

export async function setRate(input: {
  ruleSet: RuleSetRow;
  salesperson: string;
  jobId?: string | null;
  ratePct: number;
  effectiveFrom: string;
  note?: string | null;
  actor: RuleActor;
}): Promise<StoredRate> {
  const salesperson = input.salesperson.trim();
  if (!salesperson) throw new ValidationError("Choose a salesperson.");
  if (!ISO.test(input.effectiveFrom))
    throw new ValidationError("Effective date must be YYYY-MM-DD.");
  if (!(input.ratePct >= 0 && input.ratePct <= 100))
    throw new ValidationError("Rate must be between 0% and 100%.");
  const jobId = input.jobId ?? null;
  const rates = await listRates(input.ruleSet.id);
  const same = rates.filter(
    (r) =>
      r.salesperson.toLowerCase() === salesperson.toLowerCase() && (r.job_id ?? null) === jobId,
  );
  // A rate starting the same day replaces that row; an earlier open rate is closed the day before.
  for (const r of same) {
    if (r.effective_from === input.effectiveFrom) {
      await agentDb().remove("bi_commission_rates", [eq("id", r.id)]);
      await recordChange({
        rule_set_id: input.ruleSet.id,
        entity: "rate",
        entity_id: r.id,
        action: "replaced",
        before: r,
        after: null,
        note: input.note ?? null,
        actor: input.actor,
      });
    } else if (
      r.effective_from < input.effectiveFrom &&
      (!r.effective_to || r.effective_to >= input.effectiveFrom)
    ) {
      const closed = { effective_to: dayBefore(input.effectiveFrom) };
      await agentDb().update("bi_commission_rates", [eq("id", r.id)], closed);
      await recordChange({
        rule_set_id: input.ruleSet.id,
        entity: "rate",
        entity_id: r.id,
        action: "ended",
        before: r,
        after: { ...r, ...closed },
        note: input.note ?? null,
        actor: input.actor,
      });
    }
  }
  const later = same
    .filter((r) => r.effective_from > input.effectiveFrom)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const [row] = await agentDb().insert<StoredRate>("bi_commission_rates", {
    rule_set_id: input.ruleSet.id,
    salesperson,
    job_id: jobId,
    rate_pct: input.ratePct,
    effective_from: input.effectiveFrom,
    effective_to: later ? dayBefore(later.effective_from) : null,
    note: input.note ?? null,
    created_by: input.actor.userId,
  });
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: row!.id,
    action: "set",
    before: null,
    after: row!,
    note: input.note ?? null,
    actor: input.actor,
  });
  return row!;
}

export async function listAssignments(ruleSetId: string): Promise<StoredAssignment[]> {
  return agentDb().select<StoredAssignment>("bi_project_assignments", {
    filters: [eq("rule_set_id", ruleSetId), { col: "removed_at", op: "is_null" }],
    order: { col: "created_at" },
  });
}

/** Assign (or update) a salesperson on a project. Splits for one project may not exceed 100%. */
export async function assignProject(input: {
  ruleSet: RuleSetRow;
  jobId: string;
  salesperson: string;
  splitPct?: number;
  paymentDate?: string | null;
  note?: string | null;
  actor: RuleActor;
}): Promise<StoredAssignment> {
  const salesperson = input.salesperson.trim();
  if (!salesperson) throw new ValidationError("Choose a salesperson.");
  if (!/^[A-Za-z0-9]{6,40}$/.test(input.jobId))
    throw new ValidationError("Choose a JobTread project.");
  if (input.paymentDate && !ISO.test(input.paymentDate))
    throw new ValidationError("Payment date must be YYYY-MM-DD.");
  const split = input.splitPct ?? 100;
  if (!(split > 0 && split <= 100)) throw new ValidationError("Split must be between 1% and 100%.");
  const active = (await listAssignments(input.ruleSet.id)).filter((a) => a.job_id === input.jobId);
  const existing = active.find((a) => a.salesperson.toLowerCase() === salesperson.toLowerCase());
  const others = active.filter((a) => a !== existing).reduce((s, a) => s + Number(a.split_pct), 0);
  if (others + split > 100.001)
    throw new ValidationError(
      `Splits on this project would total ${others + split}%. Lower another salesperson's split first.`,
    );
  if (existing) {
    const patch = {
      split_pct: split,
      payment_date: input.paymentDate === undefined ? existing.payment_date : input.paymentDate,
      note: input.note ?? existing.note,
    };
    const [updated] = await agentDb().update<StoredAssignment>(
      "bi_project_assignments",
      [eq("id", existing.id)],
      patch,
    );
    await recordChange({
      rule_set_id: input.ruleSet.id,
      entity: "assignment",
      entity_id: existing.id,
      action: "updated",
      before: existing,
      after: updated,
      note: input.note ?? null,
      actor: input.actor,
    });
    return updated!;
  }
  const [row] = await agentDb().insert<StoredAssignment>("bi_project_assignments", {
    rule_set_id: input.ruleSet.id,
    job_id: input.jobId,
    salesperson,
    split_pct: split,
    payment_date: input.paymentDate ?? null,
    note: input.note ?? null,
    created_by: input.actor.userId,
    removed_at: null,
  });
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "assignment",
    entity_id: row!.id,
    action: "assigned",
    before: null,
    after: row!,
    note: input.note ?? null,
    actor: input.actor,
  });
  return row!;
}

export async function removeAssignment(
  ruleSet: RuleSetRow,
  assignmentId: string,
  actor: RuleActor,
): Promise<void> {
  const [row] = await agentDb().select<StoredAssignment>("bi_project_assignments", {
    filters: [eq("id", assignmentId), eq("rule_set_id", ruleSet.id)],
  });
  if (!row || row.removed_at) throw new NotFoundError("Assignment not found.");
  await agentDb().update("bi_project_assignments", [eq("id", row.id)], {
    removed_at: new Date().toISOString(),
  });
  await recordChange({
    rule_set_id: ruleSet.id,
    entity: "assignment",
    entity_id: row.id,
    action: "removed",
    before: row,
    after: null,
    note: null,
    actor,
  });
}

export async function listRuleChanges(ruleSetId: string, limit = 100): Promise<RuleChangeRow[]> {
  return agentDb().select<RuleChangeRow>("bi_rule_changes", {
    filters: [eq("rule_set_id", ruleSetId)],
    order: { col: "created_at", ascending: false },
    limit,
  });
}
