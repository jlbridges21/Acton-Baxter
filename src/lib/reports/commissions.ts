/**
 * Commission calculations (pure, deterministic, reproducible).
 *
 *   commission = eligible gross profit × rate % × split %
 *
 * Every input is explicit: the gross-profit basis comes from JobTread documents, the rate and
 * assignment come from Baxter business rules (effective-dated), and the commission date comes
 * from the configured date source. Missing inputs produce a status, never a guessed number.
 * Money is rounded to cents once, at the end.
 */

import type { JobFinancials } from "./financials";

export const GROSS_PROFIT_BASES = ["order_gross_profit", "job_projected_gross_profit"] as const;
export type GrossProfitBasis = (typeof GROSS_PROFIT_BASES)[number];

export const COMMISSION_DATE_SOURCES = [
  "assignment_payment_date",
  "order_date",
  "last_invoice_date",
] as const;
export type CommissionDateSource = (typeof COMMISSION_DATE_SOURCES)[number];

export const BASIS_LABELS: Record<GrossProfitBasis, string> = {
  order_gross_profit: "Customer order price − cost (approved order, else latest draft)",
  job_projected_gross_profit: "JobTread projected price − projected cost",
};

export const DATE_SOURCE_LABELS: Record<CommissionDateSource, string> = {
  assignment_payment_date: "Payment date entered in Baxter for the project",
  order_date: "Customer order issue date (JobTread)",
  last_invoice_date: "Latest customer invoice date (JobTread)",
};

export type CommissionConfig = {
  basis: GrossProfitBasis;
  dateSource: CommissionDateSource;
  /** Use JobTread's job "Sales Rep" field when Baxter has no assignment for a job. */
  useJobTreadSalesRep: boolean;
  /** "zero": a loss earns no commission; "include": negative commissions are shown. */
  negativeGrossProfit: "zero" | "include";
  /** Optional roster; when set, only these salespeople appear. */
  salespeople: string[];
};

export const DEFAULT_COMMISSION_CONFIG: CommissionConfig = {
  basis: "order_gross_profit",
  dateSource: "assignment_payment_date",
  useJobTreadSalesRep: true,
  negativeGrossProfit: "zero",
  salespeople: [],
};

export type RateRow = {
  /** Stored rate id (absent for ad-hoc rows): recorded on each commission as provenance. */
  id?: string;
  salesperson: string;
  job_id: string | null;
  rate_pct: number | string;
  effective_from: string;
  effective_to: string | null;
};

export type AssignmentRow = {
  job_id: string;
  salesperson: string;
  split_pct: number | string;
  payment_date: string | null;
};

export type CommissionJob = {
  id: string;
  name: string;
  number: string | null;
  salesReps: string[];
  projectedPrice: number | null;
  projectedCost: number | null;
  financials: JobFinancials;
};

export type CommissionStatus =
  "payable" | "scheduled" | "awaiting_date" | "missing_rate" | "missing_gross_profit";

export const STATUS_LABELS: Record<CommissionStatus, string> = {
  payable: "Payable",
  scheduled: "Scheduled",
  awaiting_date: "Awaiting payment date",
  missing_rate: "No rate set",
  missing_gross_profit: "No gross profit in JobTread",
};

export type CommissionRow = {
  id: string;
  jobId: string;
  jobName: string;
  jobNumber: string | null;
  salesperson: string;
  assignmentSource: "Baxter" | "JobTread Sales Rep";
  splitPct: number;
  grossProfit: number | null;
  ratePct: number | null;
  rateSource: "project override" | "salesperson rate" | null;
  rateEffectiveFrom: string | null;
  /** The stored rate that produced ratePct (provenance). */
  rateId: string | null;
  commission: number | null;
  commissionDate: string | null;
  status: CommissionStatus;
  statusLabel: string;
  orderStatus: string | null;
  notes: string[];
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().toLowerCase();

export function grossProfitFor(job: CommissionJob, basis: GrossProfitBasis): number | null {
  if (basis === "job_projected_gross_profit") {
    return job.projectedPrice !== null && job.projectedCost !== null
      ? cents(job.projectedPrice - job.projectedCost)
      : null;
  }
  return job.financials.orderGrossProfit;
}

/**
 * The rate in effect on `date` for a salesperson on a job. A project-specific override wins
 * over the salesperson's general rate. Rows are effective [from, to] inclusive.
 */
export function rateFor(rates: RateRow[], salesperson: string, jobId: string, date: string) {
  const live = rates.filter(
    (r) =>
      norm(r.salesperson) === norm(salesperson) &&
      r.effective_from <= date &&
      (!r.effective_to || r.effective_to >= date),
  );
  const pick = (rows: RateRow[]) =>
    [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const override = pick(live.filter((r) => r.job_id === jobId));
  if (override)
    return {
      rate: num(override.rate_pct),
      source: "project override" as const,
      from: override.effective_from,
      rateId: override.id ?? null,
    };
  const general = pick(live.filter((r) => !r.job_id));
  if (general)
    return {
      rate: num(general.rate_pct),
      source: "salesperson rate" as const,
      from: general.effective_from,
      rateId: general.id ?? null,
    };
  return null;
}

export function computeCommissions(input: {
  config: CommissionConfig;
  jobs: CommissionJob[];
  rates: RateRow[];
  assignments: AssignmentRow[];
  /** ISO date used for "payable" vs "scheduled" and for rates when no commission date exists. */
  today: string;
}): CommissionRow[] {
  const { config } = input;
  const roster = config.salespeople.length ? new Set(config.salespeople.map(norm)) : null;
  const byJob = new Map<string, AssignmentRow[]>();
  for (const a of input.assignments) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a]);
  const rows: CommissionRow[] = [];

  for (const job of input.jobs) {
    const baxter = byJob.get(job.id) ?? [];
    const people: Array<{
      salesperson: string;
      split: number;
      source: CommissionRow["assignmentSource"];
      paymentDate: string | null;
    }> = baxter.length
      ? baxter.map((a) => ({
          salesperson: a.salesperson,
          split: num(a.split_pct) ?? 100,
          source: "Baxter",
          paymentDate: a.payment_date,
        }))
      : config.useJobTreadSalesRep && job.salesReps.length
        ? job.salesReps.map((s) => ({
            salesperson: s,
            split: cents(100 / job.salesReps.length),
            source: "JobTread Sales Rep",
            paymentDate: null,
          }))
        : [];
    const splitTotal = people.reduce((s, p) => s + p.split, 0);

    for (const p of people) {
      if (roster && !roster.has(norm(p.salesperson))) continue;
      const notes: string[] = [];
      const grossProfit = grossProfitFor(job, config.basis);
      const date =
        config.dateSource === "assignment_payment_date"
          ? p.paymentDate
          : config.dateSource === "order_date"
            ? job.financials.orderDate
            : job.financials.lastInvoiceDate;
      const rate = rateFor(input.rates, p.salesperson, job.id, date ?? input.today);
      let commission: number | null = null;
      if (grossProfit !== null && rate?.rate != null) {
        const eligible = grossProfit < 0 && config.negativeGrossProfit === "zero" ? 0 : grossProfit;
        if (grossProfit < 0)
          notes.push(
            config.negativeGrossProfit === "zero"
              ? "Negative gross profit; commission set to $0 by policy."
              : "Negative gross profit; commission is negative.",
          );
        commission = cents((eligible * rate.rate * p.split) / 10_000);
      }
      if (
        config.basis === "order_gross_profit" &&
        job.financials.orderStatus &&
        job.financials.orderStatus !== "approved"
      ) {
        notes.push(`Gross profit comes from a ${job.financials.orderStatus} customer order.`);
      }
      if (baxter.length && Math.abs(splitTotal - 100) > 0.01)
        notes.push(`Splits on this project total ${cents(splitTotal)}%.`);
      const status: CommissionStatus =
        grossProfit === null
          ? "missing_gross_profit"
          : !rate || rate.rate === null
            ? "missing_rate"
            : !date
              ? "awaiting_date"
              : date <= input.today
                ? "payable"
                : "scheduled";
      rows.push({
        id: `${job.id}:${norm(p.salesperson)}`,
        jobId: job.id,
        jobName: job.name,
        jobNumber: job.number,
        salesperson: p.salesperson,
        assignmentSource: p.source,
        splitPct: p.split,
        grossProfit,
        ratePct: rate?.rate ?? null,
        rateSource: rate?.source ?? null,
        rateEffectiveFrom: rate?.from ?? null,
        rateId: rate?.rateId ?? null,
        commission,
        commissionDate: date,
        status,
        statusLabel: STATUS_LABELS[status],
        orderStatus: job.financials.orderStatus,
        notes,
      });
    }
  }
  return rows.sort(
    (a, b) => a.salesperson.localeCompare(b.salesperson) || a.jobName.localeCompare(b.jobName),
  );
}
