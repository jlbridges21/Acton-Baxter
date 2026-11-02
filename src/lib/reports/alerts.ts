/**
 * Configurable alerts: rule administration (audited), evaluation with dedupe, deliveries with
 * retry, and the in-app inbox (acknowledge / resolve). Rules start disabled and nothing is
 * sent anywhere until an administrator enables a complete rule. Slack is used only when the
 * Slack bot is already authorized (SLACK_BOT_TOKEN) and the rule names a channel.
 */

import "server-only";

import { agentDb, eq, isUniqueViolation, StoreError } from "@/lib/agents/store";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import type { Requester } from "@/lib/agents/types";
import {
  ALERT_KIND_LABELS,
  alertRuleInputSchema,
  evaluateRule,
  isFinancialRule,
  isRecipient,
  MAX_DELIVERY_ATTEMPTS,
  nextAttemptAt,
  planDeliveries,
  ruleProblem,
  type AlertContext,
  type AlertRule,
  type AlertRuleInput,
} from "./alert-core";
import type { ReportsAccess } from "./access";
import { isMissingSchema, MIGRATION_084 } from "./financial-data";
import { financialState } from "./financial-overview";
import { forecastChanges } from "./snapshots";

export type AlertEvent = {
  id: string;
  rule_id: string;
  dedupe_key: string;
  kind: string;
  severity: string;
  title: string;
  detail: Record<string, unknown>;
  subject_type: string | null;
  subject_id: string | null;
  status: "open" | "acknowledged" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

type Delivery = {
  id: string;
  event_id: string;
  recipient: string;
  channel: "in_app" | "slack";
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
};

const migrationError = () =>
  new StoreError(`Alerts need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");

async function audit(
  action: string,
  actor: string,
  ids: { ruleId?: string; eventId?: string },
  detail: Record<string, unknown> = {},
) {
  await agentDb()
    .insert("bi_alert_audit", {
      rule_id: ids.ruleId ?? null,
      event_id: ids.eventId ?? null,
      action,
      actor,
      detail,
    })
    .catch(() => undefined);
}

export function slackAuthorized(): boolean {
  try {
    return Boolean(getEnv().SLACK_BOT_TOKEN);
  } catch {
    return false;
  }
}

function normalizeRule(r: AlertRule): AlertRule {
  return {
    ...r,
    config: (r.config ?? {}) as Record<string, unknown>,
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
  };
}

export async function listAlertRules(): Promise<{
  rules: Array<AlertRule & { problem: string | null; financial: boolean }>;
  migrated: boolean;
}> {
  try {
    const rows = (
      await agentDb().select<AlertRule>("bi_alert_rules", { order: { col: "key" }, limit: 200 })
    ).map(normalizeRule);
    return {
      rules: rows.map((r) => ({
        ...r,
        problem: ruleProblem(r),
        financial: isFinancialRule(r, rows),
      })),
      migrated: true,
    };
  } catch (error) {
    if (isMissingSchema(error)) return { rules: [], migrated: false };
    throw error;
  }
}

/** Create or update a rule. A rule can only be enabled once its settings are complete. */
export async function saveAlertRule(raw: unknown, actor: string) {
  const input: AlertRuleInput = alertRuleInputSchema.parse(raw);
  const rule = {
    key: input.key,
    kind: input.kind,
    name: input.name,
    enabled: input.enabled,
    config: input.config,
    recipients: input.recipients,
    channel: input.channel,
    slack_channel: input.channel === "slack" ? input.slackChannel : null,
  };
  const problem = ruleProblem(rule);
  if (rule.enabled && problem) throw new ValidationError(`Can't enable "${rule.name}": ${problem}`);
  if (rule.enabled && rule.channel === "slack" && !slackAuthorized())
    throw new ValidationError(
      "Slack isn't authorized for Baxter, so this rule can only deliver in-app.",
    );
  try {
    const [existing] = await agentDb().select<AlertRule>("bi_alert_rules", {
      filters: [eq("key", rule.key)],
      limit: 1,
    });
    const now = new Date().toISOString();
    const [saved] = await agentDb().upsert<AlertRule>(
      "bi_alert_rules",
      { ...rule, updated_by: actor, updated_at: now, ...(existing ? {} : { created_by: actor }) },
      ["key"],
    );
    await audit(
      existing ? "rule_updated" : "rule_created",
      actor,
      { ruleId: saved!.id },
      {
        before: existing
          ? {
              enabled: existing.enabled,
              config: existing.config,
              recipients: existing.recipients,
              channel: existing.channel,
            }
          : null,
        after: {
          enabled: rule.enabled,
          config: rule.config,
          recipients: rule.recipients,
          channel: rule.channel,
        },
      },
    );
    return normalizeRule(saved!);
  } catch (error) {
    if (isMissingSchema(error)) throw migrationError();
    throw error;
  }
}

/** Build the evaluation context from the synced data and the latest two snapshots. */
export async function alertContext(rules: AlertRule[]): Promise<AlertContext> {
  const [state, forecasts, openEvents] = await Promise.all([
    financialState(),
    forecastChanges(),
    agentDb()
      .select<AlertEvent>("bi_alert_events", {
        filters: [{ col: "status", op: "in", value: ["open", "acknowledged"] }],
        limit: 5000,
      })
      .catch(() => [] as AlertEvent[]),
  ]);
  const jobsById = state.ctx.jobs;
  const invoices = state.invoices
    .filter((i) => ["issued", "partially_paid"].includes(i.facts.lifecycle))
    .map((i) => ({
      id: i.doc.id,
      number: i.doc.number,
      jobId: i.doc.job_id,
      jobName: i.doc.job_id ? (jobsById.get(i.doc.job_id)?.name ?? null) : null,
      dueDate: i.doc.due_date,
      balance: i.facts.balance,
      daysPastDue: i.facts.daysPastDue,
      overdue: i.facts.overdue,
      verified: i.facts.verification === "verified" || i.facts.verification === "accepted",
    }));
  const byJob = new Map<string, typeof invoices>();
  for (const inv of invoices)
    if (inv.jobId) byJob.set(inv.jobId, [...(byJob.get(inv.jobId) ?? []), inv]);
  const slip = new Map(forecasts.map((f) => [f.jobId, f]));
  const jobIds = new Set([...byJob.keys(), ...slip.keys()]);
  const jobs = [...jobIds].map((jobId) => {
    const list = byJob.get(jobId) ?? [];
    const verified = list.every((i) => i.verified);
    const sum = (vals: Array<number | null>) =>
      vals.some((v) => v === null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0);
    const overdue = list.filter((i) => i.overdue === true);
    const f = slip.get(jobId);
    return {
      jobId,
      jobName: jobsById.get(jobId)?.name ?? f?.jobName ?? null,
      financialVerified: verified,
      metrics: {
        max_days_past_due: verified ? Math.max(0, ...list.map((i) => i.daysPastDue ?? 0)) : null,
        overdue_invoice_count: verified ? overdue.length : null,
        outstanding_balance: verified ? sum(list.map((i) => i.balance)) : null,
        overdue_balance: verified ? sum(overdue.map((i) => i.balance)) : null,
        forecast_slip_days: f && !f.caveat ? f.deltaDays : null,
      },
    };
  });
  const keyById = new Map(rules.map((r) => [r.id, r.key]));
  return {
    invoices,
    forecastChanges: forecasts,
    jobs,
    openEvents: openEvents.map((e) => ({
      id: e.id,
      ruleKey: keyById.get(e.rule_id) ?? "",
      subjectType: e.subject_type,
      subjectId: e.subject_id,
    })),
    rules,
  };
}

/** Evaluate every enabled rule: new events get deliveries; repeats only refresh last_seen_at. */
export async function evaluateAlerts(input: { triggeredBy: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { rules, migrated } = await listAlertRules();
  if (!migrated)
    return {
      migrated: false,
      evaluated: 0,
      created: 0,
      repeated: 0,
      suppressed: 0,
      problems: [] as string[],
    };
  const active = rules.filter((r) => r.enabled);
  if (!active.length)
    return { migrated: true, evaluated: 0, created: 0, repeated: 0, suppressed: 0, problems: [] };
  const ctx = await alertContext(rules);
  const slack = slackAuthorized();
  let created = 0;
  let repeated = 0;
  let suppressed = 0;
  const problems: string[] = [];
  for (const rule of active) {
    const result = evaluateRule(rule, ctx);
    if (result.problem) {
      problems.push(`${rule.key}: ${result.problem}`);
      continue;
    }
    suppressed += result.suppressed.length;
    for (const c of result.candidates) {
      try {
        const [event] = await agentDb().insert<AlertEvent>("bi_alert_events", {
          rule_id: rule.id,
          dedupe_key: c.dedupeKey,
          kind: rule.kind,
          severity: c.severity,
          title: c.title.slice(0, 300),
          detail: c.detail,
          subject_type: c.subjectType,
          subject_id: c.subjectId,
          status: "open",
          first_seen_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        });
        created++;
        await audit(
          "event_created",
          input.triggeredBy,
          { ruleId: rule.id, eventId: event!.id },
          { dedupeKey: c.dedupeKey },
        );
        for (const plan of planDeliveries(rule, slack)) {
          await agentDb().insert("bi_alert_deliveries", {
            event_id: event!.id,
            recipient: plan.recipient,
            channel: plan.channel,
            status: plan.status,
            attempts: plan.status === "sent" ? 1 : 0,
            last_error: plan.reason,
            next_attempt_at: plan.status === "pending" ? now.toISOString() : null,
            sent_at: plan.status === "sent" ? now.toISOString() : null,
          });
        }
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        repeated++;
        await agentDb().update(
          "bi_alert_events",
          [
            eq("dedupe_key", c.dedupeKey),
            { col: "status", op: "in", value: ["open", "acknowledged"] },
          ],
          { last_seen_at: now.toISOString() },
        );
      }
    }
  }
  const deliveries = await processDeliveries(now);
  await audit(
    "evaluated",
    input.triggeredBy,
    {},
    { created, repeated, suppressed, problems, deliveries },
  );
  return {
    migrated: true,
    evaluated: active.length,
    created,
    repeated,
    suppressed,
    problems,
    deliveries,
  };
}

/** Send pending Slack deliveries and retry failed ones (exponential backoff, 5 attempts). */
export async function processDeliveries(
  now = new Date(),
  send?: (channel: string, text: string) => Promise<void>,
) {
  const due = await agentDb()
    .select<Delivery>("bi_alert_deliveries", {
      filters: [{ col: "status", op: "in", value: ["pending", "failed"] }],
      limit: 200,
    })
    .catch(() => [] as Delivery[]);
  const ready = due.filter(
    (d) =>
      d.channel === "slack" &&
      d.attempts < MAX_DELIVERY_ATTEMPTS &&
      (!d.next_attempt_at || d.next_attempt_at <= now.toISOString()),
  );
  let sent = 0;
  let failed = 0;
  for (const d of ready) {
    const [event] = await agentDb().select<AlertEvent>("bi_alert_events", {
      filters: [eq("id", d.event_id)],
      limit: 1,
    });
    if (!event || event.status === "resolved") {
      await agentDb().update("bi_alert_deliveries", [eq("id", d.id)], {
        status: "skipped",
        last_error: "Resolved before delivery",
      });
      continue;
    }
    const channel = d.recipient.replace(/^slack:/, "");
    try {
      if (!slackAuthorized() && !send) throw new Error("Slack isn't authorized for Baxter.");
      const text = `*${ALERT_KIND_LABELS[event.kind as keyof typeof ALERT_KIND_LABELS] ?? event.kind}*: ${event.title}\nOpen Baxter → Reports → Alerts to acknowledge or resolve.`;
      if (send) await send(channel, text);
      else await (await import("@/lib/slack/client")).postSlackMessage({ channel, text });
      await agentDb().update("bi_alert_deliveries", [eq("id", d.id)], {
        status: "sent",
        attempts: d.attempts + 1,
        sent_at: now.toISOString(),
        last_error: null,
        next_attempt_at: null,
      });
      sent++;
    } catch (error) {
      const attempts = d.attempts + 1;
      await agentDb().update("bi_alert_deliveries", [eq("id", d.id)], {
        status: "failed",
        attempts,
        last_error: error instanceof Error ? error.message.slice(0, 200) : "Delivery failed",
        next_attempt_at: attempts < MAX_DELIVERY_ATTEMPTS ? nextAttemptAt(attempts, now) : null,
      });
      await audit("delivery_failed", "system", { eventId: d.event_id }, { attempts });
      failed++;
    }
  }
  return { sent, failed };
}

/** From the job sweep: evaluate at most once an hour. Never throws. */
export async function maybeEvaluateScheduledAlerts(now = new Date()) {
  try {
    if ((process.env.BAXTER_ALERTS ?? "").toLowerCase() === "off")
      return { ran: false, reason: "BAXTER_ALERTS=off" };
    const [last] = await agentDb().select<{ created_at: string }>("bi_alert_audit", {
      filters: [eq("action", "evaluated")],
      order: { col: "created_at", ascending: false },
      limit: 1,
    });
    if (last && now.getTime() - Date.parse(last.created_at) < 60 * 60_000)
      return { ran: false, reason: "Evaluated within the hour" };
    const r = await evaluateAlerts({ triggeredBy: "schedule:hourly", now });
    return { ran: r.evaluated > 0, reason: r.migrated ? `${r.created} new` : "not migrated" };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message.slice(0, 120) : "failed" };
  }
}

/** Alerts this person may see: they're a recipient (or an admin), and financial alerts need financial access. */
export async function alertInbox(
  requester: Requester,
  access: ReportsAccess,
  opts?: { status?: string; limit?: number },
) {
  const { rules, migrated } = await listAlertRules();
  if (!migrated) return { migrated: false, events: [] };
  const byId = new Map(rules.map((r) => [r.id, r]));
  const events = await agentDb().select<AlertEvent>("bi_alert_events", {
    ...(opts?.status ? { filters: [eq("status", opts.status)] } : {}),
    order: { col: "last_seen_at", ascending: false },
    limit: Math.min(opts?.limit ?? 100, 500),
  });
  const visible = events.filter((e) => {
    const rule = byId.get(e.rule_id);
    if (!rule) return false;
    if (rule.financial && !access.categories.has("financial")) return false;
    return access.isAdmin || isRecipient(rule.recipients, requester);
  });
  return {
    migrated: true,
    events: visible.map((e) => ({
      ...e,
      ruleKey: byId.get(e.rule_id)?.key,
      ruleName: byId.get(e.rule_id)?.name,
    })),
  };
}

export async function updateAlertStatus(input: {
  eventId: string;
  action: "acknowledge" | "resolve" | "reopen";
  note?: string | null;
  requester: Requester;
  access: ReportsAccess;
}) {
  const inbox = await alertInbox(input.requester, input.access, { limit: 500 });
  const event = inbox.events.find((e) => e.id === input.eventId);
  if (!event) throw new ValidationError("That alert doesn't exist or isn't yours to update.");
  const actor = input.requester.userId ?? input.requester.label;
  const now = new Date().toISOString();
  const patch =
    input.action === "acknowledge"
      ? { status: "acknowledged", acknowledged_by: actor, acknowledged_at: now }
      : input.action === "resolve"
        ? {
            status: "resolved",
            resolved_by: actor,
            resolved_at: now,
            resolution_note: input.note ?? null,
          }
        : { status: "open", resolved_by: null, resolved_at: null };
  const [saved] = await agentDb().update<AlertEvent>(
    "bi_alert_events",
    [eq("id", event.id)],
    patch,
  );
  await audit(
    `event_${input.action}`,
    actor,
    { eventId: event.id, ruleId: event.rule_id },
    { note: input.note ?? null },
  );
  return saved!;
}

export async function alertHistory(eventId: string) {
  const [deliveries, trail] = await Promise.all([
    agentDb().select<Delivery>("bi_alert_deliveries", {
      filters: [eq("event_id", eventId)],
      limit: 100,
    }),
    agentDb().select("bi_alert_audit", {
      filters: [eq("event_id", eventId)],
      order: { col: "created_at" },
      limit: 200,
    }),
  ]);
  return { deliveries, audit: trail };
}
