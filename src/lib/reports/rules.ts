/**
 * Business rules configured in Baxter (not JobTread): commission rule sets, rates, and project
 * assignments. Every change is recorded in bi_rule_changes with before/after values, the
 * reason, the account and channel it was performed with, and whether commissions changed.
 *
 * Identity: a rule set is identified by its id and an opaque, stable key (`rs_…`). Names are
 * labels only — two rule sets may share a name, and nothing ever looks a rule set up by name.
 * Scope says who may use it: `dashboard` (one report owns it), `company` (deliberately shared),
 * or `template` (reference rules that dashboards copy; never bound to a live report).
 *
 * Rates are effective-dated and never edited in place once they may have applied:
 *   - setting a new rate closes the previous open rate the day before;
 *   - "end" sets the last day a rate applies;
 *   - "void" takes a rate out of every calculation but keeps the row;
 *   - "correct" supersedes a rate with a new version (the old row is kept and linked);
 *   - "restore" brings a voided or superseded rate back if nothing overlaps it;
 *   - hard delete exists only for rates that never applied (see rule-operations.ts).
 * Active rates for the same salesperson and project scope may never overlap.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { agentDb, eq, selectOne, StoreError } from "@/lib/agents/store";
import {
  COMMISSION_DATE_SOURCES,
  DEFAULT_COMMISSION_CONFIG,
  GROSS_PROFIT_BASES,
  type AssignmentRow,
  type CommissionConfig,
  type RateRow,
} from "./commissions";
import { TEMPLATE_RULE_SET_KEY } from "./rule-scope";

export { TEMPLATE_RULE_SET_KEY };

export const commissionConfigSchema = z.object({
  basis: z.enum(GROSS_PROFIT_BASES),
  dateSource: z.enum(COMMISSION_DATE_SOURCES),
  useJobTreadSalesRep: z.boolean(),
  negativeGrossProfit: z.enum(["zero", "include"]),
  salespeople: z.array(z.string().trim().min(1).max(80)).max(50),
});

export const RULE_SET_SCOPES = ["dashboard", "company", "template"] as const;
export type RuleSetScope = (typeof RULE_SET_SCOPES)[number];
export type RuleSetStatus = "active" | "archived" | "copying";

export type RuleSetRow = {
  id: string;
  key: string;
  kind: "commission";
  name: string;
  description: string;
  config: CommissionConfig & { confirmedAt?: string | null; confirmedBy?: string | null };
  scope: RuleSetScope;
  status: RuleSetStatus;
  owner_report_id: string | null;
  owner_user_id: string | null;
  copied_from_rule_set_id: string | null;
  needs_review: boolean;
  review_note: string | null;
  version: number;
  archived_at: string | null;
  archived_by_label: string | null;
  archive_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RateStatus = "active" | "voided" | "superseded";

export type StoredRate = RateRow & {
  id: string;
  rule_set_id: string;
  note: string | null;
  status: RateStatus;
  version: number;
  end_reason: string | null;
  voided_at: string | null;
  voided_by_label: string | null;
  void_reason: string | null;
  superseded_by: string | null;
  corrects_rate_id: string | null;
  copied_from_rate_id: string | null;
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
  entity: "rule_set" | "rate" | "assignment" | "binding";
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  reason?: string | null;
  via?: RuleVia | null;
  commissions_affected?: boolean | null;
  impact?: unknown;
  operation_id?: string | null;
  report_id?: string | null;
  changed_by: string | null;
  changed_by_label: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Actors and audit wording: "performed using [account], via [UI/Dexter/system]"
// ---------------------------------------------------------------------------

export type RuleVia = "ui" | "dexter" | "system";
export type RuleActor = { userId: string | null; label: string; via?: RuleVia };

const VIA_LABEL: Record<RuleVia, string> = { ui: "UI", dexter: "Dexter", system: "system" };

export function auditLabel(account: string, via: RuleVia): string {
  return `performed using ${account || "an unknown account"}, via ${VIA_LABEL[via]}`;
}

export function ruleActor(account: string, userId: string | null, via: RuleVia): RuleActor {
  return { userId, via, label: auditLabel(account, via) };
}

export const SYSTEM_RULE_ACTOR: RuleActor = ruleActor("Baxter system", null, "system");

/** Extra audit details for lifecycle operations. */
export type ChangeDetails = {
  reason?: string | null;
  commissionsAffected?: boolean | null;
  impact?: unknown;
  operationId?: string | null;
  reportId?: string | null;
};

export async function recordChange(
  input: Omit<
    RuleChangeRow,
    | "id"
    | "created_at"
    | "changed_by"
    | "changed_by_label"
    | "reason"
    | "via"
    | "commissions_affected"
    | "impact"
    | "operation_id"
    | "report_id"
  > & { actor: RuleActor; details?: ChangeDetails },
) {
  const { actor, details, ...rest } = input;
  await agentDb().insert("bi_rule_changes", {
    ...rest,
    changed_by: actor.userId,
    changed_by_label: actor.label,
    via: actor.via ?? null,
    reason: details?.reason ?? null,
    commissions_affected: details?.commissionsAffected ?? null,
    impact: details?.impact ?? null,
    operation_id: details?.operationId ?? null,
    report_id: details?.reportId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** A fresh opaque key. Keys never derive from names, so a name can't select a rule set. */
export function newRuleSetKey(): string {
  return `rs_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Database guard errors (overlap, archived rule set, …) as user-facing validation errors. */
export function asRuleError(error: unknown): unknown {
  if (error instanceof StoreError && ["23P01", "23514"].includes(error.code)) {
    return new ValidationError(error.message.replace(/^[a-z_]+: /, ""));
  }
  return error;
}

function normalizeRuleSet(row: RuleSetRow): RuleSetRow {
  return {
    ...row,
    scope: row.scope ?? "company",
    status: row.status ?? "active",
    owner_report_id: row.owner_report_id ?? null,
    owner_user_id: row.owner_user_id ?? null,
    copied_from_rule_set_id: row.copied_from_rule_set_id ?? null,
    needs_review: row.needs_review ?? false,
    review_note: row.review_note ?? null,
    version: row.version ?? 1,
    archived_at: row.archived_at ?? null,
    archived_by_label: row.archived_by_label ?? null,
    archive_reason: row.archive_reason ?? null,
  };
}

function normalizeRate(row: StoredRate): StoredRate {
  return {
    ...row,
    status: row.status ?? "active",
    version: row.version ?? 1,
    end_reason: row.end_reason ?? null,
    voided_at: row.voided_at ?? null,
    voided_by_label: row.voided_by_label ?? null,
    void_reason: row.void_reason ?? null,
    superseded_by: row.superseded_by ?? null,
    corrects_rate_id: row.corrects_rate_id ?? null,
    copied_from_rate_id: row.copied_from_rate_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Rule sets
// ---------------------------------------------------------------------------

export async function listRuleSets(): Promise<RuleSetRow[]> {
  const rows = await agentDb().select<RuleSetRow>("bi_rule_sets", {
    order: { col: "created_at" },
  });
  return rows.map(normalizeRuleSet);
}

export async function getRuleSet(key: string): Promise<RuleSetRow | null> {
  if (key === TEMPLATE_RULE_SET_KEY) return null;
  const row = await selectOne<RuleSetRow>("bi_rule_sets", { filters: [eq("key", key)] });
  return row ? normalizeRuleSet(row) : null;
}

export async function getRuleSetById(id: string): Promise<RuleSetRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await selectOne<RuleSetRow>("bi_rule_sets", { filters: [eq("id", id)] });
  return row ? normalizeRuleSet(row) : null;
}

/** By key or id. Never by name. */
export async function requireRuleSet(keyOrId: string): Promise<RuleSetRow> {
  const row = (await getRuleSet(keyOrId)) ?? (await getRuleSetById(keyOrId));
  if (!row) throw new NotFoundError(`Business rules "${keyOrId}" not found.`);
  return row;
}

export async function createRuleSet(input: {
  name: string;
  description?: string;
  config?: Partial<CommissionConfig>;
  actor: RuleActor;
  /** Explicit keys are for tests and fixtures only; they must be unused. */
  key?: string;
  scope?: RuleSetScope;
  status?: RuleSetStatus;
  ownerReportId?: string | null;
  copiedFromRuleSetId?: string | null;
  details?: ChangeDetails;
}): Promise<RuleSetRow> {
  const config = commissionConfigSchema.parse({
    ...DEFAULT_COMMISSION_CONFIG,
    ...(input.config ?? {}),
  });
  if (input.key === TEMPLATE_RULE_SET_KEY)
    throw new ValidationError(`"${TEMPLATE_RULE_SET_KEY}" is reserved for templates.`);
  if (input.key && (await getRuleSet(input.key)))
    throw new ValidationError(`A rule set with key "${input.key}" already exists.`);
  const [row] = await agentDb().insert<RuleSetRow>("bi_rule_sets", {
    key: input.key ?? newRuleSetKey(),
    kind: "commission",
    name: input.name.trim().slice(0, 120) || "Commission rules",
    description: (input.description ?? "").slice(0, 600),
    config: { ...config, confirmedAt: null, confirmedBy: null },
    scope: input.scope ?? "dashboard",
    status: input.status ?? "active",
    owner_report_id: input.ownerReportId ?? null,
    owner_user_id: input.actor.userId,
    copied_from_rule_set_id: input.copiedFromRuleSetId ?? null,
    needs_review: false,
    review_note: null,
    version: 1,
    created_by: input.actor.userId,
  });
  const created = normalizeRuleSet(row!);
  await recordChange({
    rule_set_id: created.id,
    entity: "rule_set",
    entity_id: created.id,
    action: input.copiedFromRuleSetId ? "copied" : "created",
    before: null,
    after: {
      key: created.key,
      name: created.name,
      scope: created.scope,
      config: created.config,
      copiedFrom: input.copiedFromRuleSetId ?? null,
    },
    note: null,
    actor: input.actor,
    details: input.details,
  });
  return created;
}

/**
 * Optimistic update of a rule set: succeeds only if nobody changed it since `expectedVersion`
 * (defaults to the version the caller read).
 */
export async function patchRuleSet(
  ruleSet: RuleSetRow,
  patch: Partial<RuleSetRow>,
  expectedVersion = ruleSet.version,
): Promise<RuleSetRow> {
  if (expectedVersion !== ruleSet.version)
    throw new ValidationError("These rules changed since you opened them. Reload and try again.");
  let updated: RuleSetRow[];
  try {
    updated = await agentDb().update<RuleSetRow>(
      "bi_rule_sets",
      [eq("id", ruleSet.id), eq("version", ruleSet.version)],
      { ...patch, version: ruleSet.version + 1 },
    );
  } catch (error) {
    throw asRuleError(error);
  }
  if (!updated[0])
    throw new ValidationError(
      "These rules were just changed by someone else. Reload and try again.",
    );
  return normalizeRuleSet(updated[0]);
}

/** Change calculation settings. `confirm` records that a person approved the rules. */
export async function updateRuleSetConfig(
  ruleSet: RuleSetRow,
  patch: Partial<CommissionConfig>,
  actor: RuleActor,
  options: { confirm?: boolean; note?: string } = {},
) {
  assertWritable(ruleSet);
  const { confirmedAt: _a, confirmedBy: _b, ...current } = ruleSet.config;
  void _a;
  void _b;
  const next = commissionConfigSchema.parse({ ...DEFAULT_COMMISSION_CONFIG, ...current, ...patch });
  const config = {
    ...next,
    confirmedAt: options.confirm ? new Date().toISOString() : (ruleSet.config.confirmedAt ?? null),
    confirmedBy: options.confirm ? actor.label : (ruleSet.config.confirmedBy ?? null),
  };
  const updated = await patchRuleSet(ruleSet, { config });
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
  return updated;
}

/** Archived (or half-copied) rule sets are read-only. */
export function assertWritable(ruleSet: RuleSetRow) {
  if (ruleSet.status === "archived")
    throw new ValidationError(
      `"${ruleSet.name}" is archived. Restore it before changing rates or assignments.`,
    );
  if (ruleSet.status === "copying")
    throw new ValidationError(`"${ruleSet.name}" is still being copied. Try again in a moment.`);
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** Rates used in calculations (active only) unless `includeInactive`. */
export async function listRates(
  ruleSetId: string,
  options: { includeInactive?: boolean } = {},
): Promise<StoredRate[]> {
  const rows = (
    await agentDb().select<StoredRate>("bi_commission_rates", {
      filters: [eq("rule_set_id", ruleSetId)],
      order: { col: "effective_from" },
    })
  ).map(normalizeRate);
  return options.includeInactive ? rows : rows.filter((r) => r.status === "active");
}

export async function getRate(ruleSet: RuleSetRow, rateId: string): Promise<StoredRate> {
  const row = /^[0-9a-f-]{36}$/i.test(rateId)
    ? await selectOne<StoredRate>("bi_commission_rates", {
        filters: [eq("id", rateId), eq("rule_set_id", ruleSet.id)],
      })
    : null;
  if (!row) throw new NotFoundError("Rate not found in these rules.");
  return normalizeRate(row);
}

export type RateState = "current" | "scheduled" | "ended" | "voided" | "superseded";

export function rateState(
  r: Pick<StoredRate, "status" | "effective_from" | "effective_to">,
  today: string,
): RateState {
  if (r.status === "voided") return "voided";
  if (r.status === "superseded") return "superseded";
  if (r.effective_from > today) return "scheduled";
  if (r.effective_to && r.effective_to < today) return "ended";
  return "current";
}

const norm = (s: string) => s.trim().toLowerCase();

/** Active rates whose window overlaps the candidate's (same salesperson and project scope). */
export function findOverlaps<
  R extends Pick<
    StoredRate,
    "id" | "status" | "salesperson" | "job_id" | "effective_from" | "effective_to"
  >,
>(
  rates: R[],
  candidate: {
    salesperson: string;
    job_id: string | null;
    effective_from: string;
    effective_to: string | null;
  },
  ignoreIds: string[] = [],
): R[] {
  const end = (d: string | null) => d ?? "9999-12-31";
  return rates.filter(
    (r) =>
      r.status === "active" &&
      !ignoreIds.includes(r.id) &&
      norm(r.salesperson) === norm(candidate.salesperson) &&
      (r.job_id ?? null) === (candidate.job_id ?? null) &&
      r.effective_from <= end(candidate.effective_to) &&
      candidate.effective_from <= end(r.effective_to),
  );
}

function overlapMessage(
  overlaps: Array<Pick<StoredRate, "effective_from" | "effective_to" | "rate_pct">>,
) {
  return `These dates overlap an active rate (${overlaps
    .map((o) => `${Number(o.rate_pct)}% ${o.effective_from} → ${o.effective_to ?? "open"}`)
    .join("; ")}). End or void that rate first.`;
}

async function updateRateGuarded(
  rate: StoredRate,
  patch: Partial<StoredRate>,
  expectedVersion = rate.version,
): Promise<StoredRate> {
  if (expectedVersion !== rate.version)
    throw new ValidationError("This rate changed since you opened it. Reload and try again.");
  let rows: StoredRate[];
  try {
    rows = await agentDb().update<StoredRate>(
      "bi_commission_rates",
      [eq("id", rate.id), eq("version", rate.version)],
      { ...patch, version: rate.version + 1 },
    );
  } catch (error) {
    throw asRuleError(error);
  }
  if (!rows[0])
    throw new ValidationError("This rate was just changed by someone else. Reload and try again.");
  return normalizeRate(rows[0]);
}

async function insertRate(row: Record<string, unknown>): Promise<StoredRate> {
  try {
    const [inserted] = await agentDb().insert<StoredRate>("bi_commission_rates", {
      status: "active",
      version: 1,
      end_reason: null,
      voided_at: null,
      voided_by_label: null,
      void_reason: null,
      superseded_by: null,
      corrects_rate_id: null,
      copied_from_rate_id: null,
      ...row,
    });
    return normalizeRate(inserted!);
  } catch (error) {
    throw asRuleError(error);
  }
}

export async function setRate(input: {
  ruleSet: RuleSetRow;
  salesperson: string;
  jobId?: string | null;
  ratePct: number;
  effectiveFrom: string;
  note?: string | null;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<StoredRate> {
  assertWritable(input.ruleSet);
  const salesperson = input.salesperson.trim();
  if (!salesperson) throw new ValidationError("Choose a salesperson.");
  if (!ISO_DATE.test(input.effectiveFrom))
    throw new ValidationError("Effective date must be YYYY-MM-DD.");
  if (!(input.ratePct >= 0 && input.ratePct <= 100))
    throw new ValidationError("Rate must be between 0% and 100%.");
  const jobId = input.jobId ?? null;
  const rates = await listRates(input.ruleSet.id);
  const same = rates.filter(
    (r) => norm(r.salesperson) === norm(salesperson) && (r.job_id ?? null) === jobId,
  );
  const later = same
    .filter((r) => r.effective_from > input.effectiveFrom)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const sameDay = same.find((r) => r.effective_from === input.effectiveFrom);
  // A rate starting the same day supersedes that row (kept for history); an earlier open rate
  // is closed the day before.
  if (sameDay) {
    await updateRateGuarded(sameDay, { status: "superseded" });
  }
  for (const r of same) {
    if (
      r !== sameDay &&
      r.effective_from < input.effectiveFrom &&
      (!r.effective_to || r.effective_to >= input.effectiveFrom)
    ) {
      const closed = { effective_to: dayBefore(input.effectiveFrom) };
      await updateRateGuarded(r, closed);
      await recordChange({
        rule_set_id: input.ruleSet.id,
        entity: "rate",
        entity_id: r.id,
        action: "ended",
        before: r,
        after: { ...r, ...closed },
        note: input.note ?? null,
        actor: input.actor,
        details: input.details,
      });
    }
  }
  let row: StoredRate;
  try {
    row = await insertRate({
      rule_set_id: input.ruleSet.id,
      salesperson,
      job_id: jobId,
      rate_pct: input.ratePct,
      effective_from: input.effectiveFrom,
      effective_to: later ? dayBefore(later.effective_from) : null,
      note: input.note ?? null,
      corrects_rate_id: sameDay?.id ?? null,
      created_by: input.actor.userId,
    });
  } catch (error) {
    // Undo the same-day supersession so the previous rate keeps applying.
    if (sameDay)
      await agentDb()
        .update("bi_commission_rates", [eq("id", sameDay.id)], { status: "active" })
        .catch(() => undefined);
    throw error;
  }
  if (sameDay) {
    await agentDb().update("bi_commission_rates", [eq("id", sameDay.id)], {
      superseded_by: row.id,
    });
    await recordChange({
      rule_set_id: input.ruleSet.id,
      entity: "rate",
      entity_id: sameDay.id,
      action: "replaced",
      before: sameDay,
      after: { ...sameDay, status: "superseded", superseded_by: row.id },
      note: input.note ?? null,
      actor: input.actor,
      details: input.details,
    });
  }
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: row.id,
    action: "set",
    before: null,
    after: row,
    note: input.note ?? null,
    actor: input.actor,
    details: input.details,
  });
  return row;
}

/** Last day the rate applies. Commissions dated after it no longer use this rate. */
export async function endRate(input: {
  ruleSet: RuleSetRow;
  rate: StoredRate;
  endDate: string;
  reason: string;
  expectedVersion?: number;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<StoredRate> {
  assertWritable(input.ruleSet);
  const { rate } = input;
  if (rate.status !== "active")
    throw new ValidationError(`This rate is ${rate.status}; only active rates can be ended.`);
  if (!ISO_DATE.test(input.endDate)) throw new ValidationError("End date must be YYYY-MM-DD.");
  if (input.endDate < rate.effective_from)
    throw new ValidationError(
      `A rate can't end before it starts (${rate.effective_from}). Void it instead if it should never have applied.`,
    );
  if (rate.effective_to === input.endDate)
    throw new ValidationError(`This rate already ends on ${input.endDate}.`);
  const others = await listRates(input.ruleSet.id);
  const overlaps = findOverlaps(others, { ...rate, effective_to: input.endDate }, [rate.id]);
  if (overlaps.length) throw new ValidationError(overlapMessage(overlaps));
  const updated = await updateRateGuarded(
    rate,
    { effective_to: input.endDate, end_reason: input.reason },
    input.expectedVersion,
  );
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: rate.id,
    action: "ended",
    before: rate,
    after: updated,
    note: input.reason,
    actor: input.actor,
    details: { ...input.details, reason: input.reason },
  });
  return updated;
}

/** Take a rate out of every calculation (it was entered in error). The row is kept. */
export async function voidRate(input: {
  ruleSet: RuleSetRow;
  rate: StoredRate;
  reason: string;
  expectedVersion?: number;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<StoredRate> {
  assertWritable(input.ruleSet);
  if (input.rate.status !== "active")
    throw new ValidationError(`This rate is already ${input.rate.status}.`);
  const updated = await updateRateGuarded(
    input.rate,
    {
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_by_label: input.actor.label,
      void_reason: input.reason,
    },
    input.expectedVersion,
  );
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: input.rate.id,
    action: "voided",
    before: input.rate,
    after: updated,
    note: input.reason,
    actor: input.actor,
    details: { ...input.details, reason: input.reason },
  });
  return updated;
}

export type RateCorrection = {
  ratePct?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  jobId?: string | null;
};

/** The rate a correction would produce (validated; nothing written). */
export function correctedRate(rate: StoredRate, changes: RateCorrection) {
  const next = {
    salesperson: rate.salesperson,
    job_id: changes.jobId === undefined ? rate.job_id : changes.jobId,
    rate_pct: changes.ratePct ?? Number(rate.rate_pct),
    effective_from: changes.effectiveFrom ?? rate.effective_from,
    effective_to: changes.effectiveTo === undefined ? rate.effective_to : changes.effectiveTo,
  };
  if (!(next.rate_pct >= 0 && next.rate_pct <= 100))
    throw new ValidationError("Rate must be between 0% and 100%.");
  if (
    !ISO_DATE.test(next.effective_from) ||
    (next.effective_to && !ISO_DATE.test(next.effective_to))
  )
    throw new ValidationError("Dates must be YYYY-MM-DD.");
  if (next.effective_to && next.effective_to < next.effective_from)
    throw new ValidationError("The end date is before the start date.");
  if (
    next.job_id === rate.job_id &&
    next.rate_pct === Number(rate.rate_pct) &&
    next.effective_from === rate.effective_from &&
    next.effective_to === rate.effective_to
  )
    throw new ValidationError("Nothing to correct — the values are unchanged.");
  return next;
}

/**
 * Versioned correction: the old row becomes `superseded` (kept, linked to its replacement)
 * and a new active row carries the corrected values.
 */
export async function correctRate(input: {
  ruleSet: RuleSetRow;
  rate: StoredRate;
  changes: RateCorrection;
  reason: string;
  expectedVersion?: number;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<{ previous: StoredRate; corrected: StoredRate }> {
  assertWritable(input.ruleSet);
  const { rate } = input;
  if (rate.status !== "active")
    throw new ValidationError(`This rate is ${rate.status}; restore it before correcting it.`);
  const next = correctedRate(rate, input.changes);
  const overlaps = findOverlaps(await listRates(input.ruleSet.id), next, [rate.id]);
  if (overlaps.length) throw new ValidationError(overlapMessage(overlaps));
  const superseded = await updateRateGuarded(rate, { status: "superseded" }, input.expectedVersion);
  let corrected: StoredRate;
  try {
    corrected = await insertRate({
      rule_set_id: input.ruleSet.id,
      ...next,
      note: rate.note,
      corrects_rate_id: rate.id,
      created_by: input.actor.userId,
    });
  } catch (error) {
    // Compensate: the original rate keeps applying if the correction can't be written.
    await agentDb()
      .update("bi_commission_rates", [eq("id", rate.id)], {
        status: "active",
        version: superseded.version + 1,
      })
      .catch(() => undefined);
    throw error;
  }
  const [previous] = await agentDb().update<StoredRate>(
    "bi_commission_rates",
    [eq("id", rate.id)],
    { superseded_by: corrected.id },
  );
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: corrected.id,
    action: "corrected",
    before: rate,
    after: corrected,
    note: input.reason,
    actor: input.actor,
    details: { ...input.details, reason: input.reason },
  });
  return { previous: normalizeRate(previous ?? superseded), corrected };
}

/** Bring a voided or superseded rate back into calculations (if nothing overlaps it). */
export async function restoreRate(input: {
  ruleSet: RuleSetRow;
  rate: StoredRate;
  reason: string;
  expectedVersion?: number;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<StoredRate> {
  assertWritable(input.ruleSet);
  const { rate } = input;
  if (rate.status === "active") throw new ValidationError("This rate is already active.");
  const overlaps = findOverlaps(await listRates(input.ruleSet.id), rate, [rate.id]);
  if (overlaps.length)
    throw new ValidationError(
      `${overlapMessage(overlaps)}${rate.superseded_by ? " (A correction replaced this rate — void the correction to restore it.)" : ""}`,
    );
  const updated = await updateRateGuarded(
    rate,
    {
      status: "active",
      voided_at: null,
      voided_by_label: null,
      void_reason: null,
      superseded_by: null,
    },
    input.expectedVersion,
  );
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: rate.id,
    action: "restored",
    before: rate,
    after: updated,
    note: input.reason,
    actor: input.actor,
    details: { ...input.details, reason: input.reason },
  });
  return updated;
}

/** Remove the row entirely. Callers must have verified it never applied (rule-operations.ts). */
export async function hardDeleteRate(input: {
  ruleSet: RuleSetRow;
  rate: StoredRate;
  reason: string;
  expectedVersion?: number;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<void> {
  if ((input.expectedVersion ?? input.rate.version) !== input.rate.version)
    throw new ValidationError("This rate changed since you opened it. Reload and try again.");
  const removed = await agentDb().remove("bi_commission_rates", [
    eq("id", input.rate.id),
    eq("version", input.rate.version),
  ]);
  if (!removed)
    throw new ValidationError("This rate was just changed by someone else. Reload and try again.");
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "rate",
    entity_id: input.rate.id,
    action: "hard_deleted",
    before: input.rate,
    after: null,
    note: input.reason,
    actor: input.actor,
    details: { ...input.details, reason: input.reason },
  });
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

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
  assertWritable(input.ruleSet);
  const salesperson = input.salesperson.trim();
  if (!salesperson) throw new ValidationError("Choose a salesperson.");
  if (!/^[A-Za-z0-9]{6,40}$/.test(input.jobId))
    throw new ValidationError("Choose a JobTread project.");
  if (input.paymentDate && !ISO_DATE.test(input.paymentDate))
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
  assertWritable(ruleSet);
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
