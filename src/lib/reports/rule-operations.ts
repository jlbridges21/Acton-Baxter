/**
 * Business-rule lifecycle operations shared by the Reports UI (API routes) and Dexter.
 *
 * Every operation:
 *   - is authorized here, on the server, with a precise error naming the permission that is
 *     missing and who can grant it (never a generic "forbidden");
 *   - supports a dry run that changes nothing and returns an impact preview;
 *   - takes an idempotency key, so a double-click or a retried Dexter call runs once;
 *   - takes the version the caller saw (optimistic concurrency) where it edits a row;
 *   - records the actor as "performed using [account], via [UI/Dexter/system]".
 *
 * Tenant isolation: Baxter is one company's workspace — every report, rule set, and binding
 * belongs to it. Isolation between people is enforced per call: financial access for any
 * rule data, "Edit business rules" for changes, edit permission on the report for binding
 * changes, and administrator rights for shared/company rule sets and hard deletes.
 */

import "server-only";

import { AuthorizationError, ValidationError } from "@/lib/errors";
import { agentDb, eq, isUniqueViolation, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import { CATEGORY_LABELS, type ReportsAccess } from "./access";
import type { RateRow } from "./commissions";
import {
  archiveRuleSetRow,
  BINDING_MODE_LABELS,
  copyRuleSet,
  listBindingsForReport,
  listConsumers,
  restoreRuleSetRow,
  setRuleSetScope,
} from "./rule-bindings";
import { describeImpact, previewRateImpact, type RateImpact } from "./rule-impact";
import { rewriteRuleSetKeys, ruleSetKeysIn, TEMPLATE_RULE_SET_KEY } from "./rule-scope";
import {
  correctedRate,
  correctRate,
  dayBefore,
  endRate,
  getRate,
  hardDeleteRate,
  ISO_DATE,
  requireRuleSet,
  restoreRate,
  ruleActor,
  setRate,
  todayIso,
  voidRate,
  type RateCorrection,
  type RuleActor,
  type RuleSetRow,
  type RuleVia,
  type StoredRate,
} from "./rules";

// ---------------------------------------------------------------------------
// Caller context and permissions
// ---------------------------------------------------------------------------

export type RuleCaller = {
  access: ReportsAccess;
  requester: Requester;
  via: RuleVia;
};

export function callerActor(caller: RuleCaller): RuleActor {
  return ruleActor(caller.requester.label, caller.requester.userId, caller.via);
}

export type PermissionNeed = "view" | "edit_rules" | "edit_report" | "admin";

export const PERMISSION_LABELS: Record<PermissionNeed, string> = {
  view: `${CATEGORY_LABELS.financial} (Reports)`,
  edit_rules: "Edit business rules (Reports)",
  edit_report: "Edit permission on this report",
  admin: "Administrator",
};

/** A refused operation: which permission is missing and who can help. */
export class RulePermissionError extends AuthorizationError {
  readonly requiredPermission: PermissionNeed;
  readonly handoff: string;
  constructor(need: PermissionNeed, action: string) {
    const handoff =
      need === "admin"
        ? "Ask a Baxter administrator to do this (they can see the impact preview first)."
        : need === "edit_report"
          ? "Ask the report's owner or an administrator to share it with you for editing, or duplicate it to get your own copy."
          : `Ask an administrator to grant "${PERMISSION_LABELS[need]}" on Dexter's Access tab, or to make this change for you.`;
    super(
      `${action} needs "${PERMISSION_LABELS[need]}".${
        need === "edit_rules" ? " This account can view but not change business rules." : ""
      } ${handoff}`,
    );
    this.requiredPermission = need;
    this.handoff = handoff;
  }
}

export function requireRulePermission(caller: RuleCaller, need: PermissionNeed, action: string) {
  const a = caller.access;
  if (!a.categories.has("financial")) throw new RulePermissionError("view", action);
  if (need === "view") return;
  if (need === "admin") {
    if (!a.isAdmin) throw new RulePermissionError("admin", action);
    return;
  }
  if (!a.canEditRules) throw new RulePermissionError("edit_rules", action);
}

/** Company and template rule sets affect many dashboards: administrators only. */
export function needForRuleSet(rs: RuleSetRow): PermissionNeed {
  return rs.scope === "dashboard" ? "edit_rules" : "admin";
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

type OperationRow = {
  id: string;
  idempotency_key: string;
  operation: string;
  status: "pending" | "succeeded" | "failed";
  result: unknown;
  error: string | null;
};

const opKey = (caller: RuleCaller, idempotencyKey: string) =>
  `${caller.requester.userId ?? "system"}:${idempotencyKey}`.slice(0, 200);

/**
 * The stored result of an already-completed operation with this key (checked before any
 * validation, so a retry after success replays even though the data has since changed).
 */
async function priorResult<T>(
  caller: RuleCaller,
  idempotencyKey: string | null | undefined,
  operation: string,
): Promise<T | null> {
  if (!idempotencyKey) return null;
  const row = await selectOne<OperationRow>("bi_rule_operations", {
    filters: [eq("idempotency_key", opKey(caller, idempotencyKey))],
  });
  if (!row) return null;
  if (row.operation !== operation)
    throw new ValidationError("That idempotency key was already used for a different change.");
  return row.status === "succeeded" ? (row.result as T) : null;
}

/**
 * Run `fn` once per (account, idempotency key). A repeat with the same key returns the stored
 * result; a repeat while the first is still running is refused instead of applied twice.
 */
export async function runOnce<T>(
  input: {
    caller: RuleCaller;
    idempotencyKey?: string | null;
    operation: string;
    request: unknown;
  },
  fn: (operationId: string | null) => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!input.idempotencyKey) return { result: await fn(null), replayed: false };
  const key = opKey(input.caller, input.idempotencyKey);
  let op: OperationRow;
  try {
    [op] = (await agentDb().insert<OperationRow>("bi_rule_operations", {
      idempotency_key: key,
      operation: input.operation,
      status: "pending",
      actor_id: input.caller.requester.userId,
      actor_label: input.caller.requester.label,
      via: input.caller.via,
      request: JSON.parse(JSON.stringify(input.request ?? {})),
      result: null,
      error: null,
    })) as [OperationRow];
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await selectOne<OperationRow>("bi_rule_operations", {
      filters: [eq("idempotency_key", key)],
    });
    if (!existing) throw error;
    if (existing.operation !== input.operation)
      throw new ValidationError("That idempotency key was already used for a different change.");
    if (existing.status === "succeeded") return { result: existing.result as T, replayed: true };
    if (existing.status === "pending")
      throw new ValidationError("This change is already being saved. Reload in a moment.");
    // A failed attempt may be retried with the same key.
    const [claimed] = await agentDb().update<OperationRow>(
      "bi_rule_operations",
      [eq("id", existing.id), eq("status", "failed")],
      { status: "pending", error: null },
    );
    if (!claimed)
      throw new ValidationError("This change is already being saved. Reload in a moment.");
    op = claimed;
  }
  try {
    const result = await fn(op.id);
    await agentDb().update("bi_rule_operations", [eq("id", op.id)], {
      status: "succeeded",
      result: JSON.parse(JSON.stringify(result ?? null)),
      completed_at: new Date().toISOString(),
    });
    return { result, replayed: false };
  } catch (error) {
    await agentDb()
      .update("bi_rule_operations", [eq("id", op.id)], {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Failed",
        completed_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rate lifecycle
// ---------------------------------------------------------------------------

export type RateOperation =
  | {
      type: "set_rate";
      salesperson: string;
      ratePct: number;
      effectiveFrom: string;
      jobId?: string | null;
      note?: string | null;
    }
  | { type: "end_rate"; rateId: string; endDate: string; reason: string; expectedVersion?: number }
  | { type: "void_rate"; rateId: string; reason: string; expectedVersion?: number }
  | {
      type: "correct_rate";
      rateId: string;
      changes: RateCorrection;
      reason: string;
      expectedVersion?: number;
    }
  | { type: "restore_rate"; rateId: string; reason: string; expectedVersion?: number }
  | {
      type: "delete_rate";
      rateId: string;
      reason: string;
      /** Must be exactly "DELETE". */
      confirm?: string;
      expectedVersion?: number;
    };

const OP_LABELS: Record<RateOperation["type"], string> = {
  set_rate: "Setting a rate",
  end_rate: "Ending a rate",
  void_rate: "Voiding a rate",
  correct_rate: "Correcting a rate",
  restore_rate: "Restoring a rate",
  delete_rate: "Permanently deleting a rate",
};

function requireReason(reason: string | undefined, action: string): string {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new ValidationError(`${action} needs a reason (a few words).`);
  return r.slice(0, 400);
}

const asRateRow = (r: StoredRate): RateRow => ({
  id: r.id,
  salesperson: r.salesperson,
  job_id: r.job_id,
  rate_pct: r.rate_pct,
  effective_from: r.effective_from,
  effective_to: r.effective_to,
});

/** The active rate list after the operation (for impact previews). */
function simulate(op: RateOperation, rate: StoredRate | null, current: StoredRate[]): RateRow[] {
  const rows = current.map(asRateRow);
  switch (op.type) {
    case "set_rate": {
      const norm = (s: string) => s.trim().toLowerCase();
      const jobId = op.jobId ?? null;
      const same = (r: RateRow) =>
        norm(r.salesperson) === norm(op.salesperson) && (r.job_id ?? null) === jobId;
      const later = rows
        .filter((r) => same(r) && r.effective_from > op.effectiveFrom)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
      const next = rows
        .filter((r) => !(same(r) && r.effective_from === op.effectiveFrom))
        .map((r) =>
          same(r) &&
          r.effective_from < op.effectiveFrom &&
          (!r.effective_to || r.effective_to >= op.effectiveFrom)
            ? { ...r, effective_to: dayBefore(op.effectiveFrom) }
            : r,
        );
      return [
        ...next,
        {
          id: "proposed",
          salesperson: op.salesperson,
          job_id: jobId,
          rate_pct: op.ratePct,
          effective_from: op.effectiveFrom,
          effective_to: later ? dayBefore(later.effective_from) : null,
        },
      ];
    }
    case "end_rate":
      return rows.map((r) => (r.id === rate!.id ? { ...r, effective_to: op.endDate } : r));
    case "void_rate":
    case "delete_rate":
      return rows.filter((r) => r.id !== rate!.id);
    case "correct_rate": {
      const next = correctedRate(rate!, op.changes);
      return [...rows.filter((r) => r.id !== rate!.id), { id: "proposed", ...next }];
    }
    case "restore_rate":
      return [...rows, asRateRow(rate!)];
  }
}

export type RatePreview = {
  operation: RateOperation["type"];
  ruleSet: { key: string; name: string; scope: RuleSetRow["scope"]; consumers: number };
  rate: ReturnType<typeof publicRate> | null;
  impact: RateImpact | null;
  impactSummary: string;
  /** Other dashboards whose numbers change too (shared rule sets). */
  otherReports: Array<{ reportId: string; title: string }>;
  hardDeleteAllowed?: boolean;
  hardDeleteBlockedBecause?: string;
  warnings: string[];
};

export function publicRate(r: StoredRate) {
  return {
    id: r.id,
    salesperson: r.salesperson,
    jobId: r.job_id,
    ratePct: Number(r.rate_pct),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status,
    version: r.version,
    supersededBy: r.superseded_by,
    correctsRateId: r.corrects_rate_id,
    voidReason: r.void_reason,
    endReason: r.end_reason,
  };
}

/** Why a rate may not be hard-deleted (null = allowed). Deleting is only for unused rates. */
async function hardDeleteBlocker(rs: RuleSetRow, rate: StoredRate, impact: RateImpact | null) {
  if (rate.effective_from <= todayIso())
    return "it has been in effect (it may have applied to commissions). Void it instead.";
  if (!impact) return "its impact couldn't be checked. Void it instead.";
  if (impact.rowsUsingRate > 0)
    return `${impact.rowsUsingRate} commission row(s) currently use it. Void it instead.`;
  const linked = await agentDb().select<StoredRate>("bi_commission_rates", {
    filters: [eq("rule_set_id", rs.id)],
  });
  if (
    rate.superseded_by ||
    rate.corrects_rate_id ||
    linked.some((r) => r.corrects_rate_id === rate.id || r.copied_from_rate_id === rate.id)
  )
    return "other rate versions link to it (history). Void it instead.";
  return null;
}

/**
 * Preview or apply a rate operation. With `dryRun` nothing is written.
 */
export async function runRateOperation(input: {
  caller: RuleCaller;
  ruleSetKey: string;
  op: RateOperation;
  dryRun?: boolean;
  idempotencyKey?: string | null;
}): Promise<{ dryRun: boolean; replayed?: boolean; preview: RatePreview; rate?: unknown }> {
  const { caller, op } = input;
  const label = OP_LABELS[op.type];
  requireRulePermission(caller, "view", label);
  const rs = await requireRuleSet(input.ruleSetKey);
  requireRulePermission(caller, op.type === "delete_rate" ? "admin" : needForRuleSet(rs), label);
  if (!input.dryRun) {
    const prior = await priorResult<{ preview: RatePreview; rate: unknown }>(
      caller,
      input.idempotencyKey,
      `${op.type}:${rs.id}`,
    );
    if (prior) return { dryRun: false, replayed: true, ...prior };
  }
  if (op.type !== "set_rate") requireReason(op.reason, label);
  if (op.type === "set_rate" && !ISO_DATE.test(op.effectiveFrom))
    throw new ValidationError("Effective date must be YYYY-MM-DD.");
  const rate = op.type === "set_rate" ? null : await getRate(rs, op.rateId);

  const consumers = (await listConsumers(rs)).filter((c) => !c.isTemplate);
  let impact: RateImpact | null = null;
  try {
    impact = await previewRateImpact(rs, (current) => simulate(op, rate, current), rate?.id);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    impact = null; // JobTread data unavailable: the change can still be made, unpreviewed.
  }
  const warnings: string[] = [];
  if (consumers.length > 1)
    warnings.push(
      `This rule set is shared by ${consumers.length} reports; the change affects all of them.`,
    );
  if (rs.needs_review) warnings.push("This rule set's ownership is still under review.");
  if (
    rate &&
    rate.effective_from <= todayIso() &&
    (op.type === "void_rate" || op.type === "correct_rate")
  )
    warnings.push(
      "This rate has already been in effect: recalculated past commissions will change.",
    );
  const preview: RatePreview = {
    operation: op.type,
    ruleSet: { key: rs.key, name: rs.name, scope: rs.scope, consumers: consumers.length },
    rate: rate ? publicRate(rate) : null,
    impact,
    impactSummary: impact
      ? describeImpact(impact)
      : "Impact unavailable (no JobTread data loaded).",
    otherReports: consumers.map((c) => ({ reportId: c.reportId, title: c.title })),
    warnings,
  };
  if (op.type === "delete_rate") {
    const blocker = await hardDeleteBlocker(rs, rate!, impact);
    preview.hardDeleteAllowed = !blocker;
    if (blocker) preview.hardDeleteBlockedBecause = `It can't be deleted because ${blocker}`;
  }
  if (input.dryRun) return { dryRun: true, preview };

  if (op.type === "delete_rate") {
    if (preview.hardDeleteBlockedBecause)
      throw new ValidationError(preview.hardDeleteBlockedBecause);
    if (op.confirm !== "DELETE")
      throw new ValidationError(
        'Permanent deletion needs explicit confirmation: send confirm "DELETE".',
      );
  }
  const actor = callerActor(caller);
  const { result: stored, replayed } = await runOnce(
    { caller, idempotencyKey: input.idempotencyKey, operation: `${op.type}:${rs.id}`, request: op },
    async (operationId) => ({ preview, rate: await applyRate(operationId) }),
  );
  return { dryRun: false, replayed, preview: stored.preview, rate: stored.rate };

  async function applyRate(operationId: string | null) {
    const details = {
      operationId,
      commissionsAffected: impact ? impact.affectedRows > 0 : null,
      impact: impact
        ? {
            affectedRows: impact.affectedRows,
            payableAffected: impact.payableAffected,
            totalBefore: impact.totalBefore,
            totalAfter: impact.totalAfter,
            summary: describeImpact(impact),
          }
        : null,
    };
    switch (op.type) {
      case "set_rate":
        return publicRate(
          await setRate({
            ruleSet: rs,
            salesperson: op.salesperson,
            ratePct: op.ratePct,
            effectiveFrom: op.effectiveFrom,
            jobId: op.jobId ?? null,
            note: op.note,
            actor,
            details,
          }),
        );
      case "end_rate":
        return publicRate(
          await endRate({
            ruleSet: rs,
            rate: rate!,
            endDate: op.endDate,
            reason: op.reason.trim(),
            expectedVersion: op.expectedVersion,
            actor,
            details,
          }),
        );
      case "void_rate":
        return publicRate(
          await voidRate({
            ruleSet: rs,
            rate: rate!,
            reason: op.reason.trim(),
            expectedVersion: op.expectedVersion,
            actor,
            details,
          }),
        );
      case "correct_rate": {
        const r = await correctRate({
          ruleSet: rs,
          rate: rate!,
          changes: op.changes,
          reason: op.reason.trim(),
          expectedVersion: op.expectedVersion,
          actor,
          details,
        });
        return { previous: publicRate(r.previous), corrected: publicRate(r.corrected) };
      }
      case "restore_rate":
        return publicRate(
          await restoreRate({
            ruleSet: rs,
            rate: rate!,
            reason: op.reason.trim(),
            expectedVersion: op.expectedVersion,
            actor,
            details,
          }),
        );
      case "delete_rate":
        await hardDeleteRate({
          ruleSet: rs,
          rate: rate!,
          reason: op.reason.trim(),
          expectedVersion: op.expectedVersion,
          actor,
          details,
        });
        return { deleted: rate!.id };
    }
  }
}

// ---------------------------------------------------------------------------
// Rule-set lifecycle (archive / restore / scope review)
// ---------------------------------------------------------------------------

export type RuleSetOperation =
  | { type: "archive"; reason: string; expectedVersion?: number }
  | { type: "restore"; reason: string; expectedVersion?: number }
  | { type: "set_scope"; scope: RuleSetRow["scope"]; reason: string; expectedVersion?: number };

export async function runRuleSetOperation(input: {
  caller: RuleCaller;
  ruleSetKey: string;
  op: RuleSetOperation;
  dryRun?: boolean;
  idempotencyKey?: string | null;
}) {
  const { caller, op } = input;
  const label =
    op.type === "archive"
      ? "Archiving rules"
      : op.type === "restore"
        ? "Restoring rules"
        : "Changing a rule set's scope";
  requireRulePermission(caller, "view", label);
  const rs = await requireRuleSet(input.ruleSetKey);
  requireRulePermission(caller, op.type === "set_scope" ? "admin" : needForRuleSet(rs), label);
  if (!input.dryRun) {
    const prior = await priorResult<Record<string, unknown>>(
      caller,
      input.idempotencyKey,
      `${op.type}:${rs.id}`,
    );
    if (prior) return { dryRun: false, replayed: true, preview: null, ruleSet: prior };
  }
  const reason = requireReason(op.reason, label);
  const consumers = await listConsumers(rs);
  const live = consumers.filter((c) => !c.isTemplate && c.mode !== null);
  const preview = {
    operation: op.type,
    ruleSet: {
      key: rs.key,
      name: rs.name,
      scope: rs.scope,
      status: rs.status,
      version: rs.version,
    },
    consumers: consumers.map((c) => ({
      reportId: c.reportId,
      title: c.title,
      mode: c.mode,
      isTemplate: c.isTemplate,
    })),
    blockedBecause:
      op.type === "archive" && live.length
        ? `Still used by ${live.length} report(s). Detach it from them first.`
        : null,
    note:
      op.type === "archive"
        ? "Archiving keeps every rate, assignment, and change record. Nothing is deleted."
        : op.type === "restore"
          ? "The rule set becomes usable again; no rates change."
          : `Scope becomes "${op.scope}" and the review flag is cleared.`,
  };
  if (input.dryRun) return { dryRun: true, preview };
  if (preview.blockedBecause) throw new ValidationError(preview.blockedBecause);
  const actor = callerActor(caller);
  const { result, replayed } = await runOnce(
    { caller, idempotencyKey: input.idempotencyKey, operation: `${op.type}:${rs.id}`, request: op },
    async (operationId) => {
      const row =
        op.type === "archive"
          ? await archiveRuleSetRow(rs, actor, reason, op.expectedVersion, { operationId })
          : op.type === "restore"
            ? await restoreRuleSetRow(rs, actor, reason, op.expectedVersion, { operationId })
            : await setRuleSetScope(rs, op.scope, actor, reason, op.expectedVersion);
      return { key: row.key, status: row.status, scope: row.scope, version: row.version };
    },
  );
  return { dryRun: false, replayed, preview, ruleSet: result };
}

// ---------------------------------------------------------------------------
// Report-level choices: start empty, copy, attach shared, detach
// ---------------------------------------------------------------------------

export type ReportRulesOperation =
  | { type: "start_empty"; replaceKey?: string; reason?: string }
  | { type: "copy"; fromKey: string; replaceKey?: string; reason?: string }
  | { type: "attach"; key: string; confirmShared: boolean; replaceKey?: string; reason?: string }
  | { type: "detach"; key: string; reason: string };

function pickReplaceKey(keys: string[], replaceKey?: string): string {
  if (replaceKey) {
    if (!keys.includes(replaceKey))
      throw new ValidationError(`This report doesn't use rule set "${replaceKey}".`);
    return replaceKey;
  }
  if (!keys.length)
    throw new ValidationError(
      "This report has no commission data yet. Add a commission dataset (ask Dexter) before choosing its rules.",
    );
  if (keys.length > 1)
    throw new ValidationError(
      `This report uses several rule sets (${keys.join(", ")}). Say which one to replace.`,
    );
  return keys[0]!;
}

export async function runReportRulesOperation(input: {
  caller: RuleCaller;
  reportId: string;
  op: ReportRulesOperation;
  expectedVersion?: number;
  dryRun?: boolean;
  idempotencyKey?: string | null;
}) {
  const { caller, op } = input;
  const label =
    op.type === "start_empty"
      ? "Starting this dashboard's rules empty"
      : op.type === "copy"
        ? "Copying rules into this dashboard"
        : op.type === "attach"
          ? "Attaching a shared rule set"
          : "Detaching a rule set";
  requireRulePermission(caller, "edit_rules", label);
  const { loadReportFor, saveReportVersion } = await import("./repo");
  const { report, permission } = await loadReportFor(
    input.reportId,
    caller.requester,
    caller.access,
  );
  if (report.is_template)
    throw new ValidationError(
      "Templates don't have rules of their own. Create a dashboard from the template first.",
    );
  if (!permission.canEdit) throw new RulePermissionError("edit_report", label);
  if (!input.dryRun) {
    const prior = await priorResult<{ reportVersion: number; ruleSets: string[] }>(
      caller,
      input.idempotencyKey,
      `${op.type}:${report.id}`,
    );
    if (prior) return { dryRun: false, replayed: true, preview: null, result: prior };
  }
  const keys = ruleSetKeysIn(report.spec).filter((k) => k !== TEMPLATE_RULE_SET_KEY);
  const replaceKey =
    op.type === "detach" ? pickReplaceKey(keys, op.key) : pickReplaceKey(keys, op.replaceKey);
  const current = await requireRuleSet(replaceKey).catch(() => null);
  const currentConsumers = current
    ? (await listConsumers(current)).filter((c) => !c.isTemplate)
    : [];
  let target: RuleSetRow | null = null;
  if (op.type === "attach") {
    target = await requireRuleSet(op.key);
    if (target.scope !== "company")
      throw new ValidationError(
        target.scope === "dashboard"
          ? `"${target.name}" belongs to one dashboard and can't be shared. Copy it instead.`
          : `"${target.name}" is a template rule set. Copy it instead.`,
      );
    if (target.status !== "active")
      throw new ValidationError(`"${target.name}" is ${target.status}.`);
    if (!op.confirmShared)
      throw new ValidationError(
        `Attaching "${target.name}" shares its rates with ${(await listConsumers(target)).filter((c) => !c.isTemplate).length} other report(s). Confirm that you want shared rules (confirmShared: true), or copy them instead.`,
      );
  }
  if (op.type === "copy") target = await requireRuleSet(op.fromKey);
  const binding = current
    ? (await listBindingsForReport(report.id)).find((b) => b.rule_set_id === current.id)
    : undefined;
  const preview = {
    operation: op.type,
    report: { id: report.id, title: report.title, version: report.version },
    current: current
      ? {
          key: current.key,
          name: current.name,
          scope: current.scope,
          attachedAs: binding ? BINDING_MODE_LABELS[binding.mode] : "Not recorded (legacy)",
          otherReports: currentConsumers.filter((c) => c.reportId !== report.id).length,
          note:
            current.scope === "dashboard" && currentConsumers.length <= 1
              ? "Its rates stay saved. It will show as unused; archive it from the rules audit if it's no longer needed."
              : "It stays exactly as it is for the other reports that use it.",
        }
      : null,
    next:
      op.type === "start_empty" || op.type === "detach"
        ? { kind: "new empty rule set", rates: 0 }
        : op.type === "copy"
          ? { kind: "independent copy", from: target!.name, key: target!.key }
          : { kind: "shared company rule set", name: target!.name, key: target!.key },
  };
  if (input.dryRun) return { dryRun: true, preview };
  if (op.type === "detach") requireReason(op.reason, label);
  const actor = callerActor(caller);
  const { result, replayed } = await runOnce(
    {
      caller,
      idempotencyKey: input.idempotencyKey,
      operation: `${op.type}:${report.id}`,
      request: { ...op, expectedVersion: input.expectedVersion },
    },
    async () => {
      let newKey = TEMPLATE_RULE_SET_KEY;
      let copy: RuleSetRow | null = null;
      if (op.type === "copy") {
        copy = await copyRuleSet({
          source: target!,
          actor,
          name: `${report.title} rules`.slice(0, 120),
        });
        newKey = copy.key;
      } else if (op.type === "attach") newKey = target!.key;
      try {
        const saved = await saveReportVersion({
          report,
          spec: rewriteRuleSetKeys(report.spec, (k) => (k === replaceKey ? newKey : k)),
          authorId: caller.requester.userId,
          authorKind: caller.via === "dexter" ? "dexter" : "user",
          summary:
            op.type === "attach"
              ? `Attached shared rules "${target!.name}"`
              : op.type === "copy"
                ? `Copied rules from "${target!.name}"`
                : op.type === "detach"
                  ? `Detached rules "${current?.name ?? replaceKey}": ${op.reason}`
                  : "Started this dashboard's rules empty",
          expectedVersion: input.expectedVersion,
          ruleActor: actor,
          ruleChoices: op.type === "attach" ? { attachShared: [target!.key] } : undefined,
        });
        const now = ruleSetKeysIn(saved.report.spec);
        return { reportVersion: saved.report.version, ruleSets: now };
      } catch (error) {
        if (copy)
          await archiveRuleSetRow(copy, actor, "Attach to dashboard failed; never used.").catch(
            () => undefined,
          );
        throw error;
      }
    },
  );
  return { dryRun: false, replayed, preview, result };
}

/** Rule-set lookups for a report the caller may view (bindings + key references). */
export async function reportRules(caller: RuleCaller, reportId: string) {
  requireRulePermission(caller, "view", "Viewing this report's rules");
  const { loadReportFor } = await import("./repo");
  const { report, permission } = await loadReportFor(reportId, caller.requester, caller.access);
  const bindings = await listBindingsForReport(report.id, { includeDetached: true });
  const keys = ruleSetKeysIn(report.spec);
  const sets = await Promise.all(
    keys.filter((k) => k !== TEMPLATE_RULE_SET_KEY).map((k) => requireRuleSet(k).catch(() => null)),
  );
  return {
    report: {
      id: report.id,
      title: report.title,
      isTemplate: report.is_template,
      version: report.version,
    },
    canEditReport: permission.canEdit,
    usesTemplatePlaceholder: keys.includes(TEMPLATE_RULE_SET_KEY),
    ruleSets: await Promise.all(
      sets
        .filter((s): s is RuleSetRow => Boolean(s))
        .map(async (rs) => {
          const b = bindings.find((x) => x.rule_set_id === rs.id && !x.detached_at);
          const consumers = (await listConsumers(rs)).filter((c) => !c.isTemplate);
          return {
            id: rs.id,
            key: rs.key,
            name: rs.name,
            scope: rs.scope,
            status: rs.status,
            needsReview: rs.needs_review,
            otherReports: consumers.filter((c) => c.reportId !== report.id).length,
            attachedAs: b ? BINDING_MODE_LABELS[b.mode] : "Not recorded (legacy)",
            mode: b?.mode ?? null,
            attachedAt: b?.attached_at ?? null,
            attachedBy: b?.attached_by_label ?? null,
          };
        }),
    ),
    history: bindings.map((b) => ({
      ruleSetId: b.rule_set_id,
      mode: b.mode,
      attachedAt: b.attached_at,
      attachedBy: b.attached_by_label,
      detachedAt: b.detached_at,
      detachReason: b.detach_reason,
    })),
  };
}
