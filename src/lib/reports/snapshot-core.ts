/**
 * Weekly financial snapshots (pure). A snapshot records what the synced JobTread data said at
 * capture time: period, metric, dimensions, value, completeness, the sync time it was computed
 * from, and the calculation version. Rows are immutable once written, collection starts
 * prospectively (the first period is the one after snapshots are turned on), and history is
 * never backfilled or estimated.
 */

import type { Completeness, ReconciliationTotals } from "./financial-core";

export const SNAPSHOT_CALC_VERSION = "fin-1";

export type SnapshotSettings = {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. Defaults to Monday. */
  weekday: number;
  hourLocal: number;
  timezone: string;
  /** When snapshots were last turned on; periods that started earlier are never captured. */
  enabledAt?: string | null;
};

export const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  enabled: false,
  weekday: 1,
  hourLocal: 7,
  timezone: "America/Los_Angeles",
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local calendar date, weekday, and hour of an instant in a timezone. */
export function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")),
  };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The snapshot period an instant falls in: it starts on the configured weekday (local date)
 * and runs seven days. `due` is true once the local hour has passed on the period's first day
 * (or any later day, if the sweep missed it) — but only for periods that started after
 * snapshots were turned on, so collection is prospective.
 */
export function snapshotPeriod(now: Date, settings: SnapshotSettings) {
  const local = localParts(now, settings.timezone);
  const back = (local.weekday - settings.weekday + 7) % 7;
  const start = addDays(local.date, -back);
  const enabledOn = settings.enabledAt
    ? localParts(new Date(settings.enabledAt), settings.timezone).date
    : null;
  const prospective = enabledOn === null || enabledOn <= start;
  const due = prospective && (back > 0 || local.hour >= settings.hourLocal);
  return { start, end: addDays(start, 6), due, prospective };
}

export type SnapshotMetricKey =
  | "invoiced_total"
  | "paid_total"
  | "outstanding_total"
  | "overdue_total"
  | "overdue_count"
  | "invoice_count"
  | "outstanding_by_pm"
  | "job_forecast_end"
  | "late_milestones";

export const SNAPSHOT_METRICS: Record<
  SnapshotMetricKey,
  { label: string; unit: "currency" | "count" | "date"; dimension?: string; description: string }
> = {
  invoiced_total: {
    label: "Invoiced",
    unit: "currency",
    description: "Issued customer invoices (total incl. tax).",
  },
  paid_total: {
    label: "Paid",
    unit: "currency",
    description: "JobTread amount paid on issued invoices.",
  },
  outstanding_total: {
    label: "Outstanding",
    unit: "currency",
    description: "JobTread balance on issued invoices.",
  },
  overdue_total: {
    label: "Overdue",
    unit: "currency",
    description: "Verified unpaid balance past due.",
  },
  overdue_count: {
    label: "Overdue invoices",
    unit: "count",
    description: "Invoices with a verified overdue balance.",
  },
  invoice_count: {
    label: "Issued invoices",
    unit: "count",
    description: "Customer invoices counted as issued.",
  },
  outstanding_by_pm: {
    label: "Outstanding by project manager",
    unit: "currency",
    dimension: "project_manager",
    description: "JobTread balance on issued invoices, by the job's Project Manager.",
  },
  job_forecast_end: {
    label: "Forecast completion",
    unit: "date",
    dimension: "job",
    description: "JobTread schedule end date per open job (days since 1970-01-01).",
  },
  late_milestones: {
    label: "Late milestones",
    unit: "count",
    description: "Milestone groups past their end date and not complete.",
  },
};

export type SnapshotValue = {
  metric: SnapshotMetricKey;
  dimensionKey: string;
  dimensions: Record<string, string>;
  value: number | null;
  completeness: Completeness;
  detail: Record<string, unknown>;
};

export const epochDay = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
export const fromEpochDay = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Snapshot values from current data. Missing inputs give null values marked incomplete. */
export function computeSnapshotValues(input: {
  totals: ReconciliationTotals;
  outstandingByPm: Array<{ pm: string | null; balance: number | null; verified: boolean }>;
  jobs: Array<{ id: string; name: string; scheduleEnd: string | null; open: boolean }>;
  milestones: Array<{ endDate: string | null; complete: boolean; isGroup: boolean }> | null;
  today: string;
}): SnapshotValue[] {
  const t = input.totals;
  const detail = { reasons: t.reasons };
  const totalRow = (metric: SnapshotMetricKey, value: number | null): SnapshotValue => ({
    metric,
    dimensionKey: "",
    dimensions: {},
    value,
    completeness: value === null ? "incomplete" : t.completeness,
    detail,
  });
  const out: SnapshotValue[] = [
    totalRow("invoiced_total", t.invoiced),
    totalRow("paid_total", t.paid),
    totalRow("outstanding_total", t.outstanding),
    totalRow("overdue_total", t.overdue),
    totalRow("overdue_count", t.overdueCount),
    {
      metric: "invoice_count",
      dimensionKey: "",
      dimensions: {},
      value: t.countedInvoices,
      completeness: t.reasons.some((r) => r.includes("isn't mapped")) ? "partial" : "complete",
      detail,
    },
  ];
  const byPm = new Map<string, { value: number | null; unverified: number }>();
  for (const r of input.outstandingByPm) {
    const key = r.pm ?? "(No project manager)";
    const cur = byPm.get(key) ?? { value: 0, unverified: 0 };
    cur.value =
      cur.value === null || r.balance === null
        ? null
        : Math.round((cur.value + r.balance) * 100) / 100;
    if (!r.verified) cur.unverified++;
    byPm.set(key, cur);
  }
  for (const [pm, v] of byPm)
    out.push({
      metric: "outstanding_by_pm",
      dimensionKey: `pm:${pm}`,
      dimensions: { project_manager: pm },
      value: v.value,
      completeness: v.value === null ? "incomplete" : v.unverified ? "partial" : "complete",
      detail: { unverifiedInvoices: v.unverified },
    });
  for (const j of input.jobs.filter((x) => x.open))
    out.push({
      metric: "job_forecast_end",
      dimensionKey: `job:${j.id}`,
      dimensions: { job_id: j.id, job: j.name },
      value: j.scheduleEnd ? epochDay(j.scheduleEnd) : null,
      completeness: j.scheduleEnd ? "complete" : "incomplete",
      detail: j.scheduleEnd
        ? { date: j.scheduleEnd }
        : { reason: "No JobTread schedule end date." },
    });
  out.push(
    input.milestones
      ? {
          metric: "late_milestones",
          dimensionKey: "",
          dimensions: {},
          value: input.milestones.filter(
            (m) => m.isGroup && !m.complete && m.endDate !== null && m.endDate < input.today,
          ).length,
          completeness: "complete",
          detail: {},
        }
      : {
          metric: "late_milestones",
          dimensionKey: "",
          dimensions: {},
          value: null,
          completeness: "incomplete",
          detail: { reason: "Tasks aren't synced." },
        },
  );
  return out;
}

export type SnapshotRow = {
  period_start: string;
  metric: string;
  dimension_key: string;
  dimensions: Record<string, string>;
  value: number | string | null;
  completeness: Completeness;
  calc_version: string;
};

export type SnapshotChange = {
  metric: string;
  label: string;
  dimensionKey: string;
  dimensions: Record<string, string>;
  previous: number | null;
  current: number | null;
  delta: number | null;
  unit: "currency" | "count" | "date";
  /** Comparison can't be trusted: either side incomplete, or calc versions differ. */
  caveat: string | null;
  kind: "changed" | "new" | "gone";
};

const n = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));

/**
 * Week-over-week changes between two periods' snapshots ("what changed since last Monday").
 * Only rows with the same calculation version are compared value-to-value.
 */
export function diffSnapshots(previous: SnapshotRow[], current: SnapshotRow[]): SnapshotChange[] {
  const key = (r: SnapshotRow) => `${r.metric}|${r.dimension_key}`;
  const prev = new Map(previous.map((r) => [key(r), r]));
  const cur = new Map(current.map((r) => [key(r), r]));
  const out: SnapshotChange[] = [];
  for (const [k, c] of cur) {
    const p = prev.get(k);
    const meta = SNAPSHOT_METRICS[c.metric as SnapshotMetricKey];
    const unit = meta?.unit ?? "count";
    const label = meta?.label ?? c.metric;
    const cv = n(c.value);
    if (!p) {
      out.push({
        metric: c.metric,
        label,
        dimensionKey: c.dimension_key,
        dimensions: c.dimensions,
        previous: null,
        current: cv,
        delta: null,
        unit,
        caveat: null,
        kind: "new",
      });
      continue;
    }
    const pv = n(p.value);
    const caveat =
      p.calc_version !== c.calc_version
        ? `Calculated differently (${p.calc_version} → ${c.calc_version}); not directly comparable.`
        : p.completeness !== "complete" || c.completeness !== "complete"
          ? "One or both weeks had incomplete data."
          : null;
    const delta =
      pv !== null && cv !== null && p.calc_version === c.calc_version
        ? Math.round((cv - pv) * 100) / 100
        : null;
    if (delta === 0 && !caveat) continue;
    out.push({
      metric: c.metric,
      label,
      dimensionKey: c.dimension_key,
      dimensions: c.dimensions,
      previous: pv,
      current: cv,
      delta,
      unit,
      caveat,
      kind: "changed",
    });
  }
  for (const [k, p] of prev)
    if (!cur.has(k)) {
      const meta = SNAPSHOT_METRICS[p.metric as SnapshotMetricKey];
      out.push({
        metric: p.metric,
        label: meta?.label ?? p.metric,
        dimensionKey: p.dimension_key,
        dimensions: p.dimensions,
        previous: n(p.value),
        current: null,
        delta: null,
        unit: meta?.unit ?? "count",
        caveat: null,
        kind: "gone",
      });
    }
  return out.sort(
    (a, b) => a.metric.localeCompare(b.metric) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0),
  );
}
