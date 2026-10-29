/**
 * Lifecycle reminders and the recurring compliance calendar, run by the existing Sam Operations
 * sweep (cron → report_jobs → sweepOperations, about every 15 minutes). Deterministic: no model
 * calls and no polling by an LLM.
 *
 * Every reminder is one ops_reminders row, unique per (item, threshold), so a reminder is raised
 * at most once however often the sweep runs. Reminders are in-app by default. External
 * notifications stay off until leadership enables them in settings AND the recipient is a
 * configured person; even then each one is an approval-bound Slack action (never sent directly).
 * Reminder text never contains the employee's name — only the case reference and task title.
 */

import "server-only";

import { agentDb, eq, inList, isUniqueViolation } from "@/lib/agents/store";
import type { InstanceRow, StepRow } from "@/lib/ops/engine";
import { getOpsRoles, type OpsRoles } from "@/lib/ops/org";
import { addMonths } from "./rules";
import { getLifecycleSettings, type CaseSummary, type LifecycleSettings } from "./service";
import type { RecurringItem } from "./types";

const DAY = 86_400_000;
const OPEN = ["ready", "in_progress", "failed", "external_verification"];

export type ReminderThreshold = { key: string; label: string };

/** Which reminder thresholds a due date has reached today (pure). */
export function reminderThresholds(
  due: string,
  today: string,
  leadDays: number,
): ReminderThreshold[] {
  const days = Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY,
  );
  const out: ReminderThreshold[] = [];
  if (days >= 0 && days <= leadDays) out.push({ key: "due-soon", label: `due ${due}` });
  if (days <= -1) out.push({ key: "overdue-1", label: `overdue since ${due}` });
  if (days <= -7) out.push({ key: "overdue-7", label: `a week overdue (due ${due})` });
  return out;
}

function recipientFor(step: StepRow, roles: OpsRoles): string | null {
  if (step.assignee_profile_id) return step.assignee_profile_id;
  switch (step.assignee_role) {
    case "coo":
      return roles.coo;
    case "ceo":
      return roles.ceo;
    case "finance_owner":
      return roles.financeOwner;
    case "tech_ops_manager":
      return roles.techOpsManager;
    case "hr_admin":
      return roles.hrAdmins[0] ?? null;
    case "leadership":
      return roles.coo ?? roles.ceo;
    default:
      return null;
  }
}

async function raise(row: {
  refType: "lifecycle_step" | "compliance";
  refId: string;
  threshold: string;
  recipient: string | null;
  message: string;
}): Promise<boolean> {
  try {
    await agentDb().insert("ops_reminders", {
      ref_type: row.refType,
      ref_id: row.refId,
      threshold: row.threshold,
      recipient_profile_id: row.recipient,
      channel: "in_app",
      message: row.message.slice(0, 500),
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false; // already raised: never duplicate
    throw e;
  }
}

async function maybeProposeExternal(
  settings: LifecycleSettings,
  input: {
    logicalKey: string;
    recipient: string | null;
    text: string;
    instance: InstanceRow | null;
  },
) {
  if (!settings.external.enabled || settings.external.channel !== "slack" || !input.recipient)
    return false;
  const { proposeAction } = await import("@/lib/ops/actions");
  await proposeAction({
    logicalKey: input.logicalKey,
    actionType: "notify_slack",
    title: "Lifecycle reminder",
    summary: input.text,
    payload: { profileIds: [input.recipient], text: input.text },
    display: { target: "Task owner", effect: "Sends a Slack reminder after approval." },
    mode: input.instance?.mode ?? "live",
    risk: "low",
    instanceId: input.instance?.id ?? null,
    entityId: input.instance?.entity_id ?? null,
    requestedBy: { userId: null, label: "Sam (scheduled lifecycle reminder)" },
  });
  return true;
}

/** Due-soon and overdue reminders for open lifecycle tasks. */
export async function raiseTaskReminders(today: string, settings: LifecycleSettings) {
  const instances = (
    await agentDb().select<InstanceRow & { lifecycle: CaseSummary | null }>(
      "ops_workflow_instances",
      { filters: [eq("status", "active")] },
    )
  ).filter((i) => i.lifecycle);
  if (!instances.length) return { raised: 0, external: 0 };
  const byId = new Map(instances.map((i) => [i.id, i]));
  const steps = await agentDb().select<StepRow>("ops_workflow_steps", {
    filters: [inList("instance_id", [...byId.keys()]), inList("status", OPEN)],
    limit: 20_000,
  });
  const roles = await getOpsRoles();
  let raised = 0;
  let external = 0;
  for (const s of steps) {
    if (!s.due_at || !s.config.lifecycle) continue;
    const inst = byId.get(s.instance_id)!;
    for (const t of reminderThresholds(s.due_at.slice(0, 10), today, settings.leadDays)) {
      const recipient = recipientFor(s, roles);
      const text = `${inst.lifecycle!.reference}: "${s.title}" is ${t.label}.`;
      if (
        !(await raise({
          refType: "lifecycle_step",
          refId: s.id,
          threshold: t.key,
          recipient,
          message: text,
        }))
      )
        continue;
      raised++;
      if (
        await maybeProposeExternal(settings, {
          logicalKey: `lifecycle-remind:${s.id}:${t.key}`,
          recipient,
          text,
          instance: inst,
        })
      )
        external++;
    }
  }
  return { raised, external };
}

type CalendarRow = {
  id: string;
  key: string;
  item: string;
  cadence: RecurringItem["cadence"];
  verified_dates: string[];
  owner_role: string;
  owner_profile_id: string | null;
  active: boolean;
};

/** Occurrences a calendar item needs for the period containing `today` (pure). */
export function occurrencesFor(
  row: Pick<CalendarRow, "cadence" | "verified_dates">,
  today: string,
): Array<{ periodKey: string; due: string | null }> {
  const year = Number(today.slice(0, 4));
  const c = row.cadence;
  switch (c.kind) {
    case "annual": {
      const due = `${year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
      return [{ periodKey: String(year), due }];
    }
    case "quarterly": {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
      const end = new Date(Date.UTC(year, q * 3 + 3, 0)).toISOString().slice(0, 10);
      return [{ periodKey: `${year}-Q${q + 1}`, due: end }];
    }
    case "twice_yearly":
      // Dates come only from a reviewer's verified EDD schedule; without them there is no due date.
      return row.verified_dates.length
        ? row.verified_dates.map((d) => ({ periodKey: `${year}-${d}`, due: `${year}-${d}` }))
        : [{ periodKey: `${year}-unscheduled`, due: null }];
    case "per_employee_years":
      return []; // generated per employee from completed training (see below)
  }
}

/** Generate compliance occurrences (idempotent) and raise their reminders. */
export async function sweepComplianceCalendar(today: string, settings: LifecycleSettings) {
  const calendar = (await agentDb().select<CalendarRow>("ops_compliance_calendar", {})).filter(
    (r) => r.active,
  );
  let created = 0;
  let raised = 0;
  const roles = await getOpsRoles();
  for (const row of calendar) {
    const wanted = occurrencesFor(row, today);
    if (row.cadence.kind === "per_employee_years") {
      // Refresh due N years after each completed harassment training in a lifecycle case.
      const done = await agentDb().select<StepRow>("ops_workflow_steps", {
        filters: [eq("step_key", "on-harassment-training"), eq("status", "completed")],
        limit: 5000,
      });
      const years = row.cadence.years;
      const instances = done.length
        ? await agentDb().select<InstanceRow>("ops_workflow_instances", {
            filters: [
              inList(
                "id",
                done.map((d) => d.instance_id),
              ),
            ],
          })
        : [];
      for (const s of done) {
        const inst = instances.find((i) => i.id === s.instance_id);
        if (!inst?.person_id || !s.completed_at) continue;
        const due = addMonths(s.completed_at.slice(0, 10), years * 12);
        wanted.push({ periodKey: `${inst.person_id}:${due.slice(0, 4)}`, due });
      }
    }
    for (const w of wanted) {
      try {
        await agentDb().insert("ops_compliance_occurrences", {
          calendar_id: row.id,
          period_key: w.periodKey,
          person_id: w.periodKey.includes(":") ? w.periodKey.split(":")[0] : null,
          due_date: w.due,
          status: "open",
        });
        created++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }
  const open = await agentDb().select<{
    id: string;
    calendar_id: string;
    due_date: string | null;
    period_key: string;
  }>("ops_compliance_occurrences", { filters: [eq("status", "open")], limit: 5000 });
  const byId = new Map(calendar.map((c) => [c.id, c]));
  for (const o of open) {
    const cal = byId.get(o.calendar_id);
    if (!cal || !o.due_date) continue;
    // Compliance items get a 30-day heads-up as well as the usual thresholds.
    const thresholds = reminderThresholds(o.due_date, today, Math.max(30, settings.leadDays));
    for (const t of thresholds) {
      const recipient =
        cal.owner_profile_id ??
        (cal.owner_role === "coo"
          ? roles.coo
          : cal.owner_role === "tech_ops_manager"
            ? roles.techOpsManager
            : (roles.hrAdmins[0] ?? null));
      const text = `Compliance calendar: "${cal.item}" is ${t.label}.`;
      if (
        !(await raise({
          refType: "compliance",
          refId: o.id,
          threshold: t.key,
          recipient,
          message: text,
        }))
      )
        continue;
      raised++;
      await maybeProposeExternal(settings, {
        logicalKey: `compliance-remind:${o.id}:${t.key}`,
        recipient,
        text,
        instance: null,
      });
    }
  }
  return { created, raised };
}

/** Entry point from sweepOperations(). Missing tables (migration not applied) make it a no-op. */
export async function sweepLifecycle(now = new Date()): Promise<Record<string, number>> {
  const today = now.toISOString().slice(0, 10);
  const settings = await getLifecycleSettings();
  const tasks = await raiseTaskReminders(today, settings);
  const calendar = await sweepComplianceCalendar(today, settings);
  return {
    lifecycleReminders: tasks.raised + calendar.raised,
    lifecycleExternalProposed: tasks.external,
    complianceOccurrences: calendar.created,
  };
}

/** In-app reminders for the viewer (or all, for HR and leadership). */
export async function listReminders(viewer: { userId: string | null; canViewAll: boolean }) {
  const rows = await agentDb().select<{
    id: string;
    ref_type: string;
    ref_id: string;
    threshold: string;
    recipient_profile_id: string | null;
    message: string | null;
    acknowledged_at: string | null;
    created_at: string;
  }>("ops_reminders", {
    filters: [inList("ref_type", ["lifecycle_step", "compliance"])],
    order: { col: "created_at", ascending: false },
    limit: 300,
  });
  return rows.filter(
    (r) => !r.acknowledged_at && (viewer.canViewAll || r.recipient_profile_id === viewer.userId),
  );
}

export async function acknowledgeReminder(
  id: string,
  viewer: { userId: string | null; canViewAll: boolean },
) {
  const [row] = await agentDb().select<{ id: string; recipient_profile_id: string | null }>(
    "ops_reminders",
    { filters: [eq("id", id)] },
  );
  if (!row || !(viewer.canViewAll || row.recipient_profile_id === viewer.userId)) return false;
  await agentDb().update("ops_reminders", [eq("id", id)], {
    acknowledged_at: new Date().toISOString(),
  });
  return true;
}
