/**
 * Pure HR lifecycle rules: condition evaluation (with recorded reasons), due-date arithmetic,
 * the California final-pay timing rule, display statuses, and allowed status changes.
 * No I/O — shared by the planner, the server, and tests.
 */

import type {
  Condition,
  DisplayStatus,
  LifecycleDates,
  LifecycleItem,
  LifecycleProfile,
  LifecycleSubItem,
  RoleKey,
  SeparationType,
  Timing,
} from "./types";
import { ROLE_KEY_LABELS } from "./types";

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------
export type ConditionResult = {
  included: boolean;
  /** Why it was included or excluded, in plain language. */
  reasons: string[];
  /** Facts that were unknown; the item stays in and is flagged as missing information. */
  unknown: string[];
};

function roleList(roles: RoleKey[]): string {
  return roles.map((r) => ROLE_KEY_LABELS[r]).join(" / ");
}

function evaluateCondition(
  cond: Condition,
  p: LifecycleProfile,
): { pass: boolean | null; reason: string } {
  switch (cond.fact) {
    case "role": {
      if (!p.rolesConfirmed)
        return {
          pass: false,
          reason: `${roleList(cond.anyOf)} role task left out: HR has not confirmed this person's roles (a job title alone never adds role tasks or access).`,
        };
      const hit = cond.anyOf.filter((r) => p.roles.includes(r));
      return hit.length
        ? { pass: true, reason: `Confirmed role: ${roleList(hit)}.` }
        : { pass: false, reason: `Not a ${roleList(cond.anyOf)} role.` };
    }
    case "exempt":
      if (p.exempt === null) return { pass: null, reason: "Exempt status not confirmed yet." };
      return p.exempt === cond.equals
        ? { pass: true, reason: cond.equals ? "Exempt employee." : "Non-exempt employee." }
        : {
            pass: false,
            reason: cond.equals
              ? "Applies to exempt employees only."
              : "Applies to non-exempt employees only.",
          };
    case "supervisor":
      if (p.supervisor === null) return { pass: null, reason: "Supervisor status not confirmed." };
      return p.supervisor === cond.equals
        ? { pass: true, reason: cond.equals ? "Supervisor." : "Non-supervisory." }
        : { pass: false, reason: cond.equals ? "Supervisors only." : "Non-supervisors only." };
    case "headcount": {
      const range =
        cond.gte !== undefined && cond.lte !== undefined
          ? `${cond.gte} to ${cond.lte} employees`
          : cond.gte !== undefined
            ? `${cond.gte}+ employees`
            : `up to ${cond.lte} employees`;
      if (p.headcount === null)
        return {
          pass: null,
          reason: `Applies at ${range}; company headcount is not confirmed (Setup → HR lifecycle).`,
        };
      const ok =
        (cond.gte === undefined || p.headcount >= cond.gte) &&
        (cond.lte === undefined || p.headcount <= cond.lte);
      return ok
        ? { pass: true, reason: `Headcount ${p.headcount} meets the ${range} threshold.` }
        : { pass: false, reason: `Headcount ${p.headcount} is outside the ${range} threshold.` };
    }
    case "on_group_health":
      if (p.onGroupHealth === null)
        return { pass: null, reason: "Group health enrollment not confirmed." };
      return p.onGroupHealth === cond.equals
        ? { pass: true, reason: "Employee is on group health." }
        : { pass: false, reason: "Employee is not on group health." };
    case "separation":
      if (!p.separation) return { pass: null, reason: "Separation type not recorded." };
      return cond.anyOf.includes(p.separation)
        ? { pass: true, reason: "Matches the separation type." }
        : { pass: false, reason: "Does not apply to this separation type." };
  }
}

/** Evaluate an item's role scope and conditions. Unknown facts include the item and flag it. */
export function evaluateItem(item: LifecycleItem, profile: LifecycleProfile): ConditionResult {
  const reasons: string[] = [];
  const unknown: string[] = [];
  const conds: Condition[] = [
    ...(item.roles === "general" ? [] : [{ fact: "role" as const, anyOf: item.roles }]),
    ...item.conditions,
  ];
  if (!conds.length) reasons.push("Applies to all staff.");
  let included = true;
  for (const cond of conds) {
    const r = evaluateCondition(cond, profile);
    reasons.push(r.reason);
    if (r.pass === false) included = false;
    if (r.pass === null) unknown.push(r.reason);
  }
  return { included, reasons, unknown };
}

export function evaluateSubItem(sub: LifecycleSubItem, profile: LifecycleProfile): ConditionResult {
  const reasons: string[] = [];
  const unknown: string[] = [];
  let included = true;
  for (const cond of sub.conditions) {
    const r = evaluateCondition(cond, profile);
    reasons.push(r.reason);
    if (r.pass === false) included = false;
    if (r.pass === null) unknown.push(r.reason);
  }
  if (!sub.conditions.length) reasons.push("Required for every hire.");
  return { included, reasons, unknown };
}

/** COBRA (20+) or Cal-COBRA (2 to 19), from the document's thresholds. */
export function continuationCoverage(headcount: number | null): {
  notice: "COBRA" | "Cal-COBRA" | "Neither (fewer than 2 employees)" | null;
  reason: string;
} {
  if (headcount === null)
    return {
      notice: null,
      reason: "Headcount not confirmed: decide between COBRA (20+) and Cal-COBRA (2 to 19).",
    };
  if (headcount >= 20) return { notice: "COBRA", reason: `Headcount ${headcount} is 20+.` };
  if (headcount >= 2) return { notice: "Cal-COBRA", reason: `Headcount ${headcount} is 2 to 19.` };
  return { notice: "Neither (fewer than 2 employees)", reason: `Headcount ${headcount}.` };
}

// ---------------------------------------------------------------------------
// Dates (all as YYYY-MM-DD, calendar arithmetic in UTC to avoid DST drift)
// ---------------------------------------------------------------------------
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Weekends are skipped; holidays are not (flagged on the I-9 item for counsel review). */
export function addBusinessDays(date: string, days: number): string {
  let d = date;
  let left = days;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export function addMonths(date: string, months: number): string {
  const [y, m, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export type FinalPayRule = { due: string | null; rule: string; missing: string[] };

/**
 * Labor Code 201/202 as the document states it: immediately (the last day) when fired or laid
 * off; on the last day with 72+ hours' notice; otherwise within 72 hours of the resignation.
 */
export function finalPayDue(
  separation: SeparationType | null,
  dates: LifecycleDates,
): FinalPayRule {
  const missing: string[] = [];
  if (!separation) missing.push("Separation type");
  if (!dates.last_day) missing.push("Last day");
  if (separation === "resignation_without_notice" && !dates.notice_date)
    missing.push("Date notice was given");
  if (missing.length) return { due: null, rule: "Cannot compute final pay timing yet.", missing };
  switch (separation!) {
    case "involuntary":
    case "layoff":
      return {
        due: dates.last_day!,
        rule: "Fired or laid off: final pay is due immediately (the last day).",
        missing,
      };
    case "resignation_with_notice":
      return {
        due: dates.last_day!,
        rule: "Resignation with 72+ hours' notice: final pay is due on the last day.",
        missing,
      };
    case "resignation_without_notice":
      return {
        due: addDays([dates.notice_date!, dates.last_day!].sort()[1]!, 3),
        rule: "Resignation without 72 hours' notice: final pay is due within 72 hours.",
        missing,
      };
  }
}

/** Whether the notice period was at least 72 hours (3 days) before the last day. */
export function hasSeventyTwoHoursNotice(noticeDate: string, lastDay: string): boolean {
  return Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${noticeDate}T00:00:00Z`) >= 3 * DAY;
}

export type DueResult = { due: string | null; missing: string[]; note: string | null };

const ANCHOR_LABELS: Record<string, string> = {
  offer_date: "Offer date",
  start_date: "Start date",
  notice_date: "Notice date",
  last_day: "Last day",
};

/** Due date for one item. Offboarding dates are never earlier than the notice date. */
export function dueDateFor(
  timing: Timing,
  dates: LifecycleDates,
  separation: SeparationType | null,
): DueResult {
  if (timing.kind === "none") return { due: null, missing: [], note: null };
  if (timing.kind === "final_pay") {
    const r = finalPayDue(separation, dates);
    return { due: r.due, missing: r.missing, note: r.rule };
  }
  const base = dates[timing.anchor];
  if (!base) return { due: null, missing: [ANCHOR_LABELS[timing.anchor]!], note: null };
  let due =
    timing.kind === "days"
      ? addDays(base, timing.offset)
      : timing.kind === "business_days"
        ? addBusinessDays(base, timing.offset)
        : addMonths(base, timing.offset);
  let note: string | null = null;
  if (
    (timing.anchor === "last_day" || timing.anchor === "notice_date") &&
    dates.notice_date &&
    due < dates.notice_date
  ) {
    due = dates.notice_date;
    note = "Moved to the notice date (less notice than the usual lead time).";
  }
  return { due, missing: [], note };
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
export type EngineStepStatus =
  | "blocked"
  | "ready"
  | "in_progress"
  | "awaiting_approval"
  | "waiting"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled"
  | "external_verification"
  | "not_applicable";

/** The spec's seven statuses, derived from the persisted engine status and the due date. */
export function displayStatus(
  step: { status: EngineStepStatus; due_at: string | null },
  today: string,
): DisplayStatus {
  switch (step.status) {
    case "completed":
      return "completed";
    case "skipped":
    case "not_applicable":
    case "cancelled":
      return "not_applicable";
    case "awaiting_approval":
      return "awaiting_approval";
    case "external_verification":
      return "external_verification";
    case "blocked":
    case "failed":
      return "blocked";
    default:
      return step.due_at && step.due_at.slice(0, 10) < today ? "overdue" : "awaiting_action";
  }
}

export type LifecycleTransition =
  | "complete"
  | "send_to_external_verification"
  | "confirm_external_verification"
  | "mark_not_applicable"
  | "reopen";

const ALLOWED: Record<LifecycleTransition, EngineStepStatus[]> = {
  complete: ["ready", "in_progress", "failed"],
  send_to_external_verification: ["ready", "in_progress"],
  confirm_external_verification: ["external_verification"],
  mark_not_applicable: ["blocked", "ready", "in_progress", "failed"],
  reopen: ["not_applicable", "external_verification"],
};

/** Status integrity: which manual transitions are allowed from a persisted status. */
export function canTransition(from: EngineStepStatus, t: LifecycleTransition): boolean {
  return ALLOWED[t].includes(from);
}

export function transitionError(from: EngineStepStatus, t: LifecycleTransition): string {
  const what: Record<LifecycleTransition, string> = {
    complete: "completed",
    send_to_external_verification: "sent for external verification",
    confirm_external_verification: "confirmed as externally verified",
    mark_not_applicable: "marked N/A",
    reopen: "reopened",
  };
  const why =
    from === "blocked"
      ? "it is blocked by an earlier task"
      : from === "awaiting_approval"
        ? "it is waiting for a CEO/COO approval"
        : from === "completed"
          ? "it is already completed"
          : `its status is ${from.replace(/_/g, " ")}`;
  return `This task can't be ${what[t]} because ${why}.`;
}
