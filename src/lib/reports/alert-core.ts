/**
 * Configurable financial and schedule alerts (pure).
 *
 * Every threshold comes from an administrator: Baxter ships no definition of "high risk" or
 * "full recovery". A rule without its required settings is invalid and never evaluated.
 * Financial alerts (overdue invoices, and high-risk / recovery rules that read balances) are
 * suppressed for any invoice or job whose balance isn't verified — they never fire on
 * unverified payment data. Nothing is delivered outside Baxter unless the rule's channel is
 * Slack, Slack is already authorized, and an administrator named the channel.
 */

import { z } from "zod";

export const ALERT_KINDS = [
  "overdue_invoice",
  "forecast_slip",
  "forecast_improvement",
  "full_recovery",
  "high_risk",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  overdue_invoice: "Overdue invoice",
  forecast_slip: "Forecast slipped",
  forecast_improvement: "Forecast improved",
  full_recovery: "Full recovery",
  high_risk: "High-risk project",
};

export const RISK_METRICS = [
  "max_days_past_due",
  "overdue_invoice_count",
  "outstanding_balance",
  "overdue_balance",
  "forecast_slip_days",
] as const;
export type RiskMetric = (typeof RISK_METRICS)[number];
const FINANCIAL_METRICS = new Set<RiskMetric>([
  "max_days_past_due",
  "overdue_invoice_count",
  "outstanding_balance",
  "overdue_balance",
]);

export const RISK_METRIC_LABELS: Record<RiskMetric, string> = {
  max_days_past_due: "Days past due (oldest invoice)",
  overdue_invoice_count: "Overdue invoices",
  outstanding_balance: "Outstanding balance",
  overdue_balance: "Overdue balance",
  forecast_slip_days: "Forecast slip this week (days)",
};

const days = z.number().int().min(1).max(3650);
export const alertConfigSchemas = {
  overdue_invoice: z.object({ minDaysPastDue: days, minBalance: z.number().min(0).default(0) }),
  forecast_slip: z.object({ minDays: days }),
  forecast_improvement: z.object({ minDays: days }),
  high_risk: z.object({
    match: z.enum(["all", "any"]).default("all"),
    conditions: z
      .array(
        z.object({
          metric: z.enum(RISK_METRICS),
          op: z.enum(["gte", "gt"]),
          value: z.number().min(0),
        }),
      )
      .min(1, "Add at least one condition — Baxter doesn't define high risk for you.")
      .max(6),
  }),
  full_recovery: z.object({
    /** A high-risk or overdue rule key: recovery = that rule no longer applies to the job. */
    watchRuleKey: z.string().trim().min(1).max(60),
  }),
} satisfies Record<AlertKind, z.ZodTypeAny>;

export const recipientSchema = z.object({
  type: z.enum(["role", "user"]),
  value: z.string().trim().min(1).max(80),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const alertRuleInputSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_-]{1,59}$/,
      "Keys use lowercase letters, numbers, dashes, or underscores.",
    ),
  kind: z.enum(ALERT_KINDS),
  name: z.string().trim().min(2).max(120),
  enabled: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
  recipients: z.array(recipientSchema).max(30).default([]),
  channel: z.enum(["in_app", "slack"]).default("in_app"),
  slackChannel: z.string().trim().max(80).nullable().default(null),
});
export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

export type AlertRule = {
  id: string;
  key: string;
  kind: AlertKind;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  recipients: Recipient[];
  channel: "in_app" | "slack";
  slack_channel: string | null;
};

/** Why a rule can't run (missing admin settings), or null when it's valid. */
export function ruleProblem(
  rule: Pick<AlertRule, "kind" | "config" | "recipients" | "channel" | "slack_channel">,
): string | null {
  const parsed = alertConfigSchemas[rule.kind].safeParse(rule.config);
  if (!parsed.success)
    return `Settings incomplete: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  if (!rule.recipients.length) return "Choose at least one recipient (a role or a person).";
  if (rule.channel === "slack" && !rule.slack_channel) return "Name the Slack channel.";
  return null;
}

export function isFinancialRule(
  rule: Pick<AlertRule, "kind" | "config">,
  rules: AlertRule[] = [],
): boolean {
  if (rule.kind === "overdue_invoice") return true;
  if (rule.kind === "high_risk") {
    const c = alertConfigSchemas.high_risk.safeParse(rule.config);
    return !c.success || c.data.conditions.some((x) => FINANCIAL_METRICS.has(x.metric));
  }
  if (rule.kind === "full_recovery") {
    const c = alertConfigSchemas.full_recovery.safeParse(rule.config);
    const watched = c.success ? rules.find((r) => r.key === c.data.watchRuleKey) : undefined;
    return !watched || isFinancialRule(watched, []);
  }
  return false;
}

export type AlertInvoice = {
  id: string;
  number: string | null;
  jobId: string | null;
  jobName: string | null;
  dueDate: string | null;
  balance: number | null;
  daysPastDue: number | null;
  overdue: boolean | null;
  /** Balance verified (reconciled with payments, or accepted by admin policy). */
  verified: boolean;
};

export type AlertForecastChange = {
  jobId: string;
  jobName: string | null;
  previous: string | null;
  current: string | null;
  /** current − previous in days (positive = slipped later). */
  deltaDays: number | null;
  caveat: string | null;
};

export type AlertJobRisk = {
  jobId: string;
  jobName: string | null;
  metrics: Partial<Record<RiskMetric, number | null>>;
  financialVerified: boolean;
};

export type AlertContext = {
  invoices: AlertInvoice[];
  forecastChanges: AlertForecastChange[];
  jobs: AlertJobRisk[];
  /** Open (unresolved) events per rule key, for full recovery. */
  openEvents: Array<{
    id: string;
    ruleKey: string;
    subjectType: string | null;
    subjectId: string | null;
  }>;
  rules: AlertRule[];
};

export type AlertCandidate = {
  dedupeKey: string;
  subjectType: "invoice" | "job";
  subjectId: string;
  title: string;
  severity: "info" | "warning" | "critical";
  detail: Record<string, unknown>;
};

export type Evaluation = {
  candidates: AlertCandidate[];
  suppressed: Array<{ subjectId: string; reason: string }>;
  problem: string | null;
};

const money = (n: number | null) =>
  n === null ? "an unknown amount" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function riskMatches(job: AlertJobRisk, cfg: z.infer<typeof alertConfigSchemas.high_risk>) {
  const results = cfg.conditions.map((c) => {
    const v = job.metrics[c.metric];
    if (v === null || v === undefined) return null;
    return c.op === "gte" ? v >= c.value : v > c.value;
  });
  if (cfg.match === "all") return results.some((r) => r === null) ? null : results.every(Boolean);
  return results.some((r) => r === true) ? true : results.some((r) => r === null) ? null : false;
}

export function evaluateRule(rule: AlertRule, ctx: AlertContext): Evaluation {
  const problem = ruleProblem(rule);
  if (problem) return { candidates: [], suppressed: [], problem };
  const candidates: AlertCandidate[] = [];
  const suppressed: Evaluation["suppressed"] = [];
  if (rule.kind === "overdue_invoice") {
    const cfg = alertConfigSchemas.overdue_invoice.parse(rule.config);
    for (const inv of ctx.invoices) {
      if (!inv.verified) {
        if ((inv.balance ?? 0) > 0 && inv.dueDate)
          suppressed.push({ subjectId: inv.id, reason: "Balance not verified" });
        continue;
      }
      if (inv.overdue !== true || (inv.daysPastDue ?? 0) < cfg.minDaysPastDue) continue;
      if ((inv.balance ?? 0) < cfg.minBalance) continue;
      candidates.push({
        dedupeKey: `${rule.key}:invoice:${inv.id}:${inv.dueDate}`,
        subjectType: "invoice",
        subjectId: inv.id,
        title: `Invoice ${inv.number ?? inv.id}${inv.jobName ? ` (${inv.jobName})` : ""} is ${inv.daysPastDue} days past due with ${money(inv.balance)} outstanding`,
        severity: (inv.daysPastDue ?? 0) >= cfg.minDaysPastDue * 2 ? "critical" : "warning",
        detail: {
          invoiceId: inv.id,
          jobId: inv.jobId,
          balance: inv.balance,
          dueDate: inv.dueDate,
          daysPastDue: inv.daysPastDue,
        },
      });
    }
  } else if (rule.kind === "forecast_slip" || rule.kind === "forecast_improvement") {
    const cfg = alertConfigSchemas[rule.kind].parse(rule.config);
    for (const ch of ctx.forecastChanges) {
      if (ch.caveat || ch.deltaDays === null) {
        if (ch.deltaDays !== 0)
          suppressed.push({ subjectId: ch.jobId, reason: ch.caveat ?? "No comparable forecast" });
        continue;
      }
      const slipped = rule.kind === "forecast_slip" ? ch.deltaDays : -ch.deltaDays;
      if (slipped < cfg.minDays) continue;
      candidates.push({
        dedupeKey: `${rule.key}:job:${ch.jobId}:${ch.current}`,
        subjectType: "job",
        subjectId: ch.jobId,
        title: `${ch.jobName ?? ch.jobId}: forecast completion ${rule.kind === "forecast_slip" ? "slipped" : "improved"} ${Math.abs(ch.deltaDays)} days (${ch.previous} → ${ch.current})`,
        severity: rule.kind === "forecast_slip" ? "warning" : "info",
        detail: { ...ch },
      });
    }
  } else if (rule.kind === "high_risk") {
    const cfg = alertConfigSchemas.high_risk.parse(rule.config);
    const financial = isFinancialRule(rule);
    for (const job of ctx.jobs) {
      if (financial && !job.financialVerified) {
        suppressed.push({ subjectId: job.jobId, reason: "Balances not verified" });
        continue;
      }
      const hit = riskMatches(job, cfg);
      if (hit !== true) continue;
      candidates.push({
        dedupeKey: `${rule.key}:job:${job.jobId}`,
        subjectType: "job",
        subjectId: job.jobId,
        title: `${job.jobName ?? job.jobId} meets the "${rule.name}" high-risk definition`,
        severity: "critical",
        detail: {
          jobId: job.jobId,
          metrics: job.metrics,
          conditions: cfg.conditions,
          match: cfg.match,
        },
      });
    }
  } else if (rule.kind === "full_recovery") {
    const cfg = alertConfigSchemas.full_recovery.parse(rule.config);
    const watched = ctx.rules.find((r) => r.key === cfg.watchRuleKey);
    if (!watched || (watched.kind !== "high_risk" && watched.kind !== "overdue_invoice"))
      return {
        candidates: [],
        suppressed: [],
        problem: `Watched rule "${cfg.watchRuleKey}" must be an existing high-risk or overdue-invoice rule.`,
      };
    const stillActive = new Set(
      evaluateRule({ ...watched, enabled: true }, ctx).candidates.map((c) => c.subjectId),
    );
    const financial = isFinancialRule(rule, ctx.rules);
    for (const ev of ctx.openEvents.filter((e) => e.ruleKey === watched.key && e.subjectId)) {
      const jobId =
        ev.subjectType === "invoice"
          ? (ctx.invoices.find((i) => i.id === ev.subjectId)?.jobId ?? null)
          : ev.subjectId;
      const verified =
        ev.subjectType === "invoice"
          ? (ctx.invoices.find((i) => i.id === ev.subjectId)?.verified ?? false)
          : (ctx.jobs.find((j) => j.jobId === ev.subjectId)?.financialVerified ?? false);
      if (financial && !verified) {
        suppressed.push({ subjectId: ev.subjectId!, reason: "Balances not verified" });
        continue;
      }
      if (stillActive.has(ev.subjectId!)) continue;
      candidates.push({
        dedupeKey: `${rule.key}:${ev.subjectType}:${ev.subjectId}:${ev.id}`,
        subjectType: ev.subjectType === "invoice" ? "invoice" : "job",
        subjectId: ev.subjectId!,
        title: `Recovered: no longer meets "${watched.name}"`,
        severity: "info",
        detail: { watchedEventId: ev.id, watchedRule: watched.key, jobId },
      });
    }
  }
  return { candidates, suppressed, problem: null };
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/** Exponential backoff: 5 min, 10, 20, 40, … capped at 6 hours. */
export function nextAttemptAt(attempts: number, now: Date): string {
  const minutes = Math.min(5 * 2 ** Math.max(0, attempts - 1), 360);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export type DeliveryPlan = {
  recipient: string;
  channel: "in_app" | "slack";
  status: "pending" | "sent" | "skipped";
  reason: string | null;
};

/**
 * Deliveries for a new event. In-app alerts are delivered by being in the recipient's Baxter
 * inbox. Slack is attempted only when Slack is authorized and a channel is set; otherwise it's
 * recorded as skipped (with the in-app copy still delivered).
 */
export function planDeliveries(
  rule: Pick<AlertRule, "recipients" | "channel" | "slack_channel">,
  slackAuthorized: boolean,
): DeliveryPlan[] {
  const plans: DeliveryPlan[] = rule.recipients.map((r) => ({
    recipient: `${r.type}:${r.value}`,
    channel: "in_app",
    status: "sent",
    reason: null,
  }));
  if (rule.channel === "slack")
    plans.push({
      recipient: `slack:${rule.slack_channel ?? ""}`,
      channel: "slack",
      status: slackAuthorized && rule.slack_channel ? "pending" : "skipped",
      reason: !slackAuthorized
        ? "Slack isn't authorized for Baxter."
        : !rule.slack_channel
          ? "No Slack channel set."
          : null,
    });
  return plans;
}

/** Whether a requester is one of the rule's recipients. */
export function isRecipient(
  recipients: Recipient[],
  requester: { userId: string | null; role: string | null },
) {
  return recipients.some(
    (r) =>
      (r.type === "user" && r.value === requester.userId) ||
      (r.type === "role" && r.value === requester.role),
  );
}
