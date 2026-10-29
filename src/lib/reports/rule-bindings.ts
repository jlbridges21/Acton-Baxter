/**
 * Report ↔ rule-set bindings: the explicit record of which report uses which rule set, how it
 * got there (created empty, copied, attached as shared, migrated from legacy), who did it, and
 * when. A report's spec still names its rule set by key; bindings make that relationship
 * visible, enforce ownership, and keep history after a report is deleted.
 *
 * Ownership rules (enforced here and by database triggers from migration 081):
 *   - a `dashboard` rule set belongs to one report;
 *   - a `company` rule set is only used by a report after a deliberate "attach as shared";
 *   - a `template` rule set is never bound; dashboards copy it;
 *   - archived rule sets can't be attached, and a rule set in use can't be archived.
 *
 * This module never imports repo.ts (repo.ts calls into it).
 */

import "server-only";

import { ValidationError } from "@/lib/errors";
import { agentDb, eq, isUniqueViolation } from "@/lib/agents/store";
import type { ReportSpec } from "./spec";
import { rewriteRuleSetKeys, ruleSetKeysIn, TEMPLATE_RULE_SET_KEY } from "./rule-scope";
import {
  asRuleError,
  assertWritable,
  createRuleSet,
  getRuleSet,
  getRuleSetById,
  listAssignments,
  listRates,
  listRuleSets,
  patchRuleSet,
  recordChange,
  type ChangeDetails,
  type RuleActor,
  type RuleSetRow,
  type RuleVia,
} from "./rules";

export const BINDING_MODES = [
  "created_empty",
  "copied",
  "attached_shared",
  "migrated_legacy",
] as const;
export type BindingMode = (typeof BINDING_MODES)[number];

export const BINDING_MODE_LABELS: Record<BindingMode, string> = {
  created_empty: "Created empty for this dashboard",
  copied: "Copied into this dashboard",
  attached_shared: "Attached as a shared company rule set",
  migrated_legacy: "Linked before ownership existed (needs review)",
};

export type BindingRow = {
  id: string;
  report_id: string | null;
  report_ref: string;
  report_title: string;
  rule_set_id: string;
  mode: BindingMode;
  copied_from_rule_set_id: string | null;
  needs_review: boolean;
  attached_by: string | null;
  attached_by_label: string | null;
  attached_via: RuleVia;
  attached_at: string;
  detached_at: string | null;
  detached_by_label: string | null;
  detach_reason: string | null;
  created_at: string;
};

type ReportRef = { id: string; title: string; is_template?: boolean };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listBindingsForReport(
  reportId: string,
  options: { includeDetached?: boolean } = {},
): Promise<BindingRow[]> {
  const rows = await agentDb().select<BindingRow>("bi_report_rule_bindings", {
    filters: [eq("report_ref", reportId)],
    order: { col: "attached_at" },
  });
  return options.includeDetached ? rows : rows.filter((b) => !b.detached_at && b.report_id);
}

export async function listBindingsForRuleSet(ruleSetId: string): Promise<BindingRow[]> {
  const rows = await agentDb().select<BindingRow>("bi_report_rule_bindings", {
    filters: [eq("rule_set_id", ruleSetId), { col: "detached_at", op: "is_null" }],
    order: { col: "attached_at" },
  });
  return rows.filter((b) => b.report_id);
}

type ReportLite = {
  id: string;
  title: string;
  is_template: boolean;
  spec: ReportSpec;
  status: string;
};

async function allReports(): Promise<ReportLite[]> {
  return agentDb().select<ReportLite>("bi_reports", {
    columns: "id,title,is_template,spec,status",
    limit: 5000,
  });
}

export type Consumer = {
  reportId: string;
  title: string;
  isTemplate: boolean;
  /** How it is bound; null when the spec references the key with no binding (legacy). */
  mode: BindingMode | null;
  needsReview: boolean;
  attachedAt: string | null;
  attachedBy: string | null;
};

/**
 * Everything that uses a rule set: bound reports, plus reports and templates whose specs
 * reference its key without a binding (pre-081 rows, or templates that still name it).
 */
export async function listConsumers(ruleSet: RuleSetRow): Promise<Consumer[]> {
  const [bindings, reports] = await Promise.all([listBindingsForRuleSet(ruleSet.id), allReports()]);
  const byId = new Map(reports.map((r) => [r.id, r]));
  const out: Consumer[] = bindings.map((b) => ({
    reportId: b.report_id!,
    title: byId.get(b.report_id!)?.title ?? b.report_title,
    isTemplate: Boolean(byId.get(b.report_id!)?.is_template),
    mode: b.mode,
    needsReview: b.needs_review,
    attachedAt: b.attached_at,
    attachedBy: b.attached_by_label,
  }));
  const bound = new Set(out.map((c) => c.reportId));
  for (const r of reports) {
    if (bound.has(r.id) || !r.spec?.datasets) continue;
    if (ruleSetKeysIn(r.spec).includes(ruleSet.key))
      out.push({
        reportId: r.id,
        title: r.title,
        isTemplate: r.is_template,
        mode: null,
        needsReview: true,
        attachedAt: null,
        attachedBy: null,
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Binding writes
// ---------------------------------------------------------------------------

export async function bindReport(input: {
  report: ReportRef;
  ruleSet: RuleSetRow;
  mode: BindingMode;
  actor: RuleActor;
  copiedFromRuleSetId?: string | null;
  needsReview?: boolean;
  details?: ChangeDetails;
}): Promise<BindingRow> {
  if (input.report.is_template) throw new ValidationError("Templates never use a live rule set.");
  const existing = (await listBindingsForReport(input.report.id)).find(
    (b) => b.rule_set_id === input.ruleSet.id,
  );
  if (existing) return existing;
  if (input.ruleSet.status !== "active")
    throw new ValidationError(
      `"${input.ruleSet.name}" is ${input.ruleSet.status} and can't be attached.`,
    );
  if (input.ruleSet.scope === "template")
    throw new ValidationError("Template rule sets can only be copied, never attached.");
  if (input.ruleSet.scope === "dashboard") {
    const others = (await listBindingsForRuleSet(input.ruleSet.id)).filter(
      (b) => b.report_id !== input.report.id,
    );
    if (
      others.length ||
      (input.ruleSet.owner_report_id && input.ruleSet.owner_report_id !== input.report.id)
    )
      throw new ValidationError(
        `"${input.ruleSet.name}" belongs to another dashboard. Copy it instead of sharing it.`,
      );
  }
  let row: BindingRow;
  try {
    [row] = (await agentDb().insert<BindingRow>("bi_report_rule_bindings", {
      report_id: input.report.id,
      report_ref: input.report.id,
      report_title: input.report.title.slice(0, 160),
      rule_set_id: input.ruleSet.id,
      mode: input.mode,
      copied_from_rule_set_id: input.copiedFromRuleSetId ?? null,
      needs_review: input.needsReview ?? false,
      attached_by: input.actor.userId,
      attached_by_label: input.actor.label,
      attached_via: input.actor.via ?? "system",
      attached_at: new Date().toISOString(),
      detached_at: null,
      detached_by_label: null,
      detach_reason: null,
    })) as [BindingRow];
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = (await listBindingsForReport(input.report.id)).find(
        (b) => b.rule_set_id === input.ruleSet.id,
      );
      if (again) return again;
    }
    throw asRuleError(error);
  }
  if (input.ruleSet.scope === "dashboard" && !input.ruleSet.owner_report_id) {
    await patchRuleSet(input.ruleSet, { owner_report_id: input.report.id });
  }
  await recordChange({
    rule_set_id: input.ruleSet.id,
    entity: "binding",
    entity_id: row.id,
    action: "attached",
    before: null,
    after: { reportId: input.report.id, reportTitle: input.report.title, mode: input.mode },
    note: BINDING_MODE_LABELS[input.mode],
    actor: input.actor,
    details: { ...input.details, reportId: input.report.id },
  });
  return row;
}

export async function detachBinding(
  binding: BindingRow,
  actor: RuleActor,
  reason: string,
  details?: ChangeDetails,
): Promise<void> {
  if (binding.detached_at) return;
  await agentDb().update("bi_report_rule_bindings", [eq("id", binding.id)], {
    detached_at: new Date().toISOString(),
    detached_by_label: actor.label,
    detach_reason: reason.slice(0, 400),
  });
  await recordChange({
    rule_set_id: binding.rule_set_id,
    entity: "binding",
    entity_id: binding.id,
    action: "detached",
    before: { reportId: binding.report_ref, reportTitle: binding.report_title, mode: binding.mode },
    after: null,
    note: reason,
    actor,
    details: { ...details, reason, reportId: binding.report_ref },
  });
}

// ---------------------------------------------------------------------------
// Rule-set creation for dashboards
// ---------------------------------------------------------------------------

export async function createEmptyDashboardRules(input: {
  actor: RuleActor;
  name?: string;
  details?: ChangeDetails;
}): Promise<RuleSetRow> {
  return createRuleSet({
    name: input.name ?? "Commission rules",
    description: "Created empty for one dashboard. It has no rates until someone adds them.",
    scope: "dashboard",
    actor: input.actor,
    details: input.details,
  });
}

/**
 * Copy a rule set's configuration, active rates, and active assignments into a new
 * dashboard-scoped rule set. History is not copied (each copied rate links to its source).
 * The copy stays `copying` — never attachable — until every row is written; a failed copy is
 * archived, so a partial copy can never be used.
 */
export async function copyRuleSet(input: {
  source: RuleSetRow;
  actor: RuleActor;
  name?: string;
  details?: ChangeDetails;
}): Promise<RuleSetRow> {
  const { source } = input;
  if (source.status === "copying")
    throw new ValidationError("That rule set is still being copied.");
  const copy = await createRuleSet({
    name: input.name ?? source.name,
    description: source.description,
    config: (({ confirmedAt: _a, confirmedBy: _b, ...rest }) => {
      void _a;
      void _b;
      return rest;
    })(source.config),
    scope: "dashboard",
    status: "copying",
    copiedFromRuleSetId: source.id,
    actor: input.actor,
    details: input.details,
  });
  try {
    const [rates, assignments] = await Promise.all([
      listRates(source.id),
      listAssignments(source.id),
    ]);
    if (rates.length)
      await agentDb().insert(
        "bi_commission_rates",
        rates.map((r) => ({
          rule_set_id: copy.id,
          salesperson: r.salesperson,
          job_id: r.job_id,
          rate_pct: r.rate_pct,
          effective_from: r.effective_from,
          effective_to: r.effective_to,
          note: r.note,
          status: "active",
          version: 1,
          end_reason: r.end_reason,
          voided_at: null,
          voided_by_label: null,
          void_reason: null,
          superseded_by: null,
          corrects_rate_id: null,
          copied_from_rate_id: r.id,
          created_by: input.actor.userId,
        })),
      );
    if (assignments.length)
      await agentDb().insert(
        "bi_project_assignments",
        assignments.map((a) => ({
          rule_set_id: copy.id,
          job_id: a.job_id,
          salesperson: a.salesperson,
          split_pct: a.split_pct,
          payment_date: a.payment_date,
          note: a.note,
          created_by: input.actor.userId,
          removed_at: null,
        })),
      );
    return await patchRuleSet(copy, { status: "active" });
  } catch (error) {
    await patchRuleSet(copy, {
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by_label: input.actor.label,
      archive_reason: "Copy failed before it finished; never used.",
    }).catch(() => undefined);
    throw asRuleError(error);
  }
}

// ---------------------------------------------------------------------------
// Keeping bindings in step with report specs
// ---------------------------------------------------------------------------

export type RuleChoices = {
  /** Company rule sets the person deliberately chose to share (keys or ids). */
  attachShared?: string[];
};

export type PlannedRules = {
  /** The spec with the start-empty placeholder replaced by a fresh rule set key. */
  spec: ReportSpec;
  /** Fresh empty rule sets created for this spec (claimed when bound). */
  created: RuleSetRow[];
  bind: Array<{ ruleSet: RuleSetRow; mode: BindingMode; needsReview?: boolean }>;
  detach: BindingRow[];
};

function sharedChoiceRequired(rs: RuleSetRow) {
  return new ValidationError(
    `"${rs.name}" (${rs.key}) is a shared company rule set. Choose deliberately: attach it as shared (other dashboards see the same rates), copy it into this dashboard, or start empty.`,
  );
}

/**
 * Work out (and validate) the bindings a report needs for `spec`. Creates the empty rule set
 * for a start-empty placeholder; writes nothing else. Throws before any report write when a
 * reference isn't allowed, so a rejected save leaves nothing behind.
 */
export async function planRuleBindings(input: {
  report: { id: string | null; is_template: boolean };
  spec: ReportSpec;
  previousSpec: ReportSpec | null;
  actor: RuleActor;
  choices?: RuleChoices;
}): Promise<PlannedRules> {
  const empty: PlannedRules = { spec: input.spec, created: [], bind: [], detach: [] };
  if (input.report.is_template) return empty;
  const current = input.report.id ? await listBindingsForReport(input.report.id) : [];
  const boundIds = new Set(current.map((b) => b.rule_set_id));
  const previousKeys = new Set(input.previousSpec ? ruleSetKeysIn(input.previousSpec) : []);
  const shared = new Set(input.choices?.attachShared ?? []);
  let spec = input.spec;
  const created: RuleSetRow[] = [];
  const bind: PlannedRules["bind"] = [];
  const keys = ruleSetKeysIn(spec);

  if (keys.includes(TEMPLATE_RULE_SET_KEY)) {
    const fresh = await createEmptyDashboardRules({
      actor: input.actor,
      name: `${spec.title} rules`.slice(0, 120),
    });
    created.push(fresh);
    spec = rewriteRuleSetKeys(spec, (k) => (k === TEMPLATE_RULE_SET_KEY ? fresh.key : k));
    bind.push({ ruleSet: fresh, mode: "created_empty" });
  }

  const keep = new Set<string>(created.map((c) => c.id));
  for (const key of ruleSetKeysIn(spec)) {
    if (created.some((c) => c.key === key)) continue;
    const rs = await getRuleSet(key);
    if (!rs) continue; // Unknown keys are reported when the report runs.
    keep.add(rs.id);
    if (boundIds.has(rs.id)) continue;
    if (previousKeys.has(key)) {
      // Referenced before bindings existed: record it, flagged for review; never re-own it.
      bind.push({ ruleSet: rs, mode: "migrated_legacy", needsReview: true });
      continue;
    }
    if (rs.status !== "active")
      throw new ValidationError(`"${rs.name}" is ${rs.status} and can't be used by a report.`);
    if (rs.scope === "template")
      throw new ValidationError(
        `"${rs.name}" is a template rule set. Copy it into this dashboard instead of using it directly.`,
      );
    if (rs.scope === "company") {
      if (!shared.has(rs.key) && !shared.has(rs.id)) throw sharedChoiceRequired(rs);
      bind.push({ ruleSet: rs, mode: "attached_shared" });
      continue;
    }
    // Dashboard scope: only an unclaimed set (just created or copied for this report).
    const elsewhere = (await listBindingsForRuleSet(rs.id)).filter(
      (b) => b.report_id !== input.report.id,
    );
    if (elsewhere.length || (rs.owner_report_id && rs.owner_report_id !== input.report.id))
      throw new ValidationError(
        `"${rs.name}" belongs to another dashboard${elsewhere[0] ? ` ("${elsewhere[0].report_title}")` : ""}. Copy it instead.`,
      );
    bind.push({
      ruleSet: rs,
      mode: rs.copied_from_rule_set_id ? "copied" : "created_empty",
    });
  }
  const detach = current.filter((b) => !keep.has(b.rule_set_id));
  return { spec, created, bind, detach };
}

/** Apply a plan once the report row exists (bindings, ownership claims, detaches). */
export async function applyRuleBindings(input: {
  report: ReportRef;
  plan: PlannedRules;
  actor: RuleActor;
  details?: ChangeDetails;
}): Promise<void> {
  for (const b of input.plan.bind) {
    const fresh = (await getRuleSet(b.ruleSet.key)) ?? b.ruleSet;
    await bindReport({
      report: input.report,
      ruleSet: fresh,
      mode: b.mode,
      copiedFromRuleSetId: fresh.copied_from_rule_set_id,
      needsReview: b.needsReview,
      actor: input.actor,
      details: input.details,
    });
  }
  for (const d of input.plan.detach)
    await detachBinding(d, input.actor, "Removed from the report", input.details);
}

/** Undo a plan's fresh rule sets when the report write failed (never used, so archived). */
export async function discardPlannedRules(plan: PlannedRules, actor: RuleActor) {
  for (const rs of plan.created)
    await archiveRuleSetRow(rs, actor, "Report save failed; never used.").catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Archive / restore rule sets
// ---------------------------------------------------------------------------

export async function archiveRuleSetRow(
  ruleSet: RuleSetRow,
  actor: RuleActor,
  reason: string,
  expectedVersion?: number,
  details?: ChangeDetails,
): Promise<RuleSetRow> {
  if (ruleSet.status === "archived") return ruleSet;
  const users = await listBindingsForRuleSet(ruleSet.id);
  if (users.length)
    throw new ValidationError(
      `"${ruleSet.name}" is still used by ${users.length} report(s): ${users
        .map((u) => `"${u.report_title}"`)
        .join(", ")}. Detach it from them first.`,
    );
  const updated = await patchRuleSet(
    ruleSet,
    {
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by_label: actor.label,
      archive_reason: reason,
    },
    expectedVersion,
  );
  await recordChange({
    rule_set_id: ruleSet.id,
    entity: "rule_set",
    entity_id: ruleSet.id,
    action: "archived",
    before: { status: ruleSet.status },
    after: { status: "archived" },
    note: reason,
    actor,
    details: { ...details, reason },
  });
  return updated;
}

export async function restoreRuleSetRow(
  ruleSet: RuleSetRow,
  actor: RuleActor,
  reason: string,
  expectedVersion?: number,
  details?: ChangeDetails,
): Promise<RuleSetRow> {
  if (ruleSet.status !== "archived") throw new ValidationError("This rule set isn't archived.");
  const updated = await patchRuleSet(
    ruleSet,
    { status: "active", archived_at: null, archived_by_label: null, archive_reason: null },
    expectedVersion,
  );
  await recordChange({
    rule_set_id: ruleSet.id,
    entity: "rule_set",
    entity_id: ruleSet.id,
    action: "restored",
    before: { status: "archived" },
    after: { status: "active" },
    note: reason,
    actor,
    details: { ...details, reason },
  });
  return updated;
}

/** Mark a legacy rule set reviewed (scope decided by an administrator). */
export async function setRuleSetScope(
  ruleSet: RuleSetRow,
  scope: RuleSetRow["scope"],
  actor: RuleActor,
  reason: string,
  expectedVersion?: number,
): Promise<RuleSetRow> {
  assertWritable(ruleSet);
  if (scope === "dashboard") {
    const users = await listBindingsForRuleSet(ruleSet.id);
    if (users.length > 1)
      throw new ValidationError(
        `"${ruleSet.name}" is used by ${users.length} reports, so it can't belong to one dashboard. Copy it per dashboard instead.`,
      );
  }
  const owner =
    scope === "dashboard"
      ? ((await listBindingsForRuleSet(ruleSet.id))[0]?.report_id ?? null)
      : null;
  const updated = await patchRuleSet(
    ruleSet,
    { scope, owner_report_id: owner, needs_review: false, review_note: reason },
    expectedVersion,
  );
  if (ruleSet.needs_review)
    for (const b of await listBindingsForRuleSet(ruleSet.id))
      if (b.needs_review)
        await agentDb().update("bi_report_rule_bindings", [eq("id", b.id)], {
          needs_review: false,
        });
  await recordChange({
    rule_set_id: ruleSet.id,
    entity: "rule_set",
    entity_id: ruleSet.id,
    action: "scope_changed",
    before: { scope: ruleSet.scope, needsReview: ruleSet.needs_review },
    after: { scope, needsReview: false, ownerReportId: owner },
    note: reason,
    actor,
    details: { reason },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Delete impact, orphans, audit
// ---------------------------------------------------------------------------

export type DeleteImpactItem = {
  ruleSetId: string;
  key: string;
  name: string;
  scope: RuleSetRow["scope"];
  mode: BindingMode;
  otherConsumers: number;
  /** Private to this report and unused elsewhere: may be archived with the report. */
  archivable: boolean;
};

export async function reportRuleImpact(report: { id: string }): Promise<DeleteImpactItem[]> {
  const out: DeleteImpactItem[] = [];
  for (const b of await listBindingsForReport(report.id)) {
    const rs = await getRuleSetById(b.rule_set_id);
    if (!rs) continue;
    const others = (await listConsumers(rs)).filter((c) => c.reportId !== report.id);
    out.push({
      ruleSetId: rs.id,
      key: rs.key,
      name: rs.name,
      scope: rs.scope,
      mode: b.mode,
      otherConsumers: others.length,
      archivable: rs.scope === "dashboard" && others.length === 0 && rs.status === "active",
    });
  }
  return out;
}

/**
 * Before a report is deleted: detach every rule set (history kept) and, when asked, archive
 * the private ones nothing else uses. Shared rule sets are only ever detached.
 */
export async function releaseReportRules(input: {
  report: ReportRef;
  actor: RuleActor;
  archivePrivate: boolean;
}): Promise<{ detached: string[]; archived: string[]; leftUnused: string[] }> {
  const impact = await reportRuleImpact(input.report);
  const detached: string[] = [];
  const archived: string[] = [];
  const leftUnused: string[] = [];
  for (const b of await listBindingsForReport(input.report.id)) {
    await detachBinding(b, input.actor, `Report "${input.report.title}" deleted`);
    detached.push(b.rule_set_id);
  }
  for (const item of impact.filter((i) => i.archivable)) {
    const rs = await getRuleSet(item.key);
    if (!rs) continue;
    if (input.archivePrivate) {
      await archiveRuleSetRow(
        rs,
        input.actor,
        `Its dashboard "${input.report.title}" was deleted.`,
      );
      archived.push(rs.key);
    } else leftUnused.push(rs.key);
  }
  return { detached, archived, leftUnused };
}

const COPY_STALE_MS = 10 * 60_000;

export type AuditEntry = {
  id: string;
  key: string;
  name: string;
  scope: RuleSetRow["scope"];
  status: RuleSetRow["status"];
  needsReview: boolean;
  reviewNote: string | null;
  consumers: Consumer[];
  templateReferences: number;
  activeRates: number;
  inactiveRates: number;
  activeAssignments: number;
  lastChangeAt: string | null;
  orphaned: boolean;
  legacy: boolean;
  findings: string[];
};

/** Read-only audit of every rule set: consumers, legacy links, orphans, and what to review. */
export async function auditRuleSets(): Promise<AuditEntry[]> {
  const sets = await listRuleSets();
  const out: AuditEntry[] = [];
  for (const rs of sets) {
    const [consumers, rates, assignments, lastChange] = await Promise.all([
      listConsumers(rs),
      listRates(rs.id, { includeInactive: true }),
      listAssignments(rs.id),
      agentDb().select<{ created_at: string }>("bi_rule_changes", {
        filters: [eq("rule_set_id", rs.id)],
        order: { col: "created_at", ascending: false },
        limit: 1,
      }),
    ]);
    const live = consumers.filter((c) => !c.isTemplate);
    const templateReferences = consumers.filter((c) => c.isTemplate).length;
    const legacy =
      rs.needs_review || consumers.some((c) => c.mode === "migrated_legacy" || c.mode === null);
    const staleCopy =
      rs.status === "copying" && Date.now() - Date.parse(rs.updated_at) > COPY_STALE_MS;
    const orphaned = (rs.status === "active" && live.length === 0) || staleCopy;
    const findings: string[] = [];
    if (templateReferences)
      findings.push(
        `${templateReferences} template(s) still name this rule set; dashboards made from them now start empty instead.`,
      );
    if (live.length > 1 && rs.scope !== "company")
      findings.push(`${live.length} reports use this ${rs.scope} rule set.`);
    if (live.length > 1 && rs.needs_review)
      findings.push(`Shared by ${live.length} reports without a deliberate choice.`);
    if (orphaned)
      findings.push(staleCopy ? "Copy never finished." : "No report uses this rule set.");
    if (rs.needs_review) findings.push("Ownership needs an administrator's review.");
    out.push({
      id: rs.id,
      key: rs.key,
      name: rs.name,
      scope: rs.scope,
      status: rs.status,
      needsReview: rs.needs_review,
      reviewNote: rs.review_note,
      consumers,
      templateReferences,
      activeRates: rates.filter((r) => r.status === "active").length,
      inactiveRates: rates.filter((r) => r.status !== "active").length,
      activeAssignments: assignments.length,
      lastChangeAt: lastChange[0]?.created_at ?? null,
      orphaned,
      legacy,
      findings,
    });
  }
  return out;
}
