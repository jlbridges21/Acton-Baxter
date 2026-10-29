/**
 * Impact previews for rule changes: recompute commissions with the rates as they are and as
 * they would be, and report exactly which project × salesperson rows change.
 *
 * Deterministic and read-only. The same comparison is stored on the audit entry after the
 * change ("commissions affected"), so history says what a change did, not just what it was.
 */

import "server-only";

import {
  computeCommissions,
  DEFAULT_COMMISSION_CONFIG,
  type CommissionJob,
  type CommissionRow,
  type RateRow,
} from "./commissions";
import { loadCommissionJobs } from "./engine";
import { listAssignments, listRates, todayIso, type RuleSetRow, type StoredRate } from "./rules";

export type ImpactRow = {
  jobId: string;
  jobName: string;
  salesperson: string;
  status: string;
  before: { ratePct: number | null; commission: number | null };
  after: { ratePct: number | null; commission: number | null };
};

export type RateImpact = {
  /** Rows whose rate or commission changes. */
  affectedRows: number;
  /** Of those, rows dated on or before today (already payable). */
  payableAffected: number;
  totalBefore: number;
  totalAfter: number;
  rows: ImpactRow[];
  /** Rows that currently take their rate from the rate being changed (provenance). */
  rowsUsingRate: number;
  truncated: boolean;
};

const MAX_ROWS = 25;
const cents = (n: number) => Math.round(n * 100) / 100;

/** Pure comparison of two rate lists over the same jobs and assignments. */
export function compareCommissions(input: {
  ruleSet: Pick<RuleSetRow, "config">;
  jobs: CommissionJob[];
  assignments: Parameters<typeof computeCommissions>[0]["assignments"];
  before: RateRow[];
  after: RateRow[];
  rateId?: string | null;
  today?: string;
}): RateImpact {
  const today = input.today ?? todayIso();
  const config = { ...DEFAULT_COMMISSION_CONFIG, ...input.ruleSet.config };
  const run = (rates: RateRow[]) =>
    computeCommissions({ config, jobs: input.jobs, rates, assignments: input.assignments, today });
  const before = run(input.before);
  const after = new Map(run(input.after).map((r) => [r.id, r]));
  const changed: Array<{ b: CommissionRow; a: CommissionRow | undefined }> = [];
  for (const b of before) {
    const a = after.get(b.id);
    if (!a || a.ratePct !== b.ratePct || a.commission !== b.commission) changed.push({ b, a });
  }
  const sum = (rows: Iterable<CommissionRow>) =>
    cents([...rows].reduce((s, r) => s + (r.commission ?? 0), 0));
  return {
    affectedRows: changed.length,
    payableAffected: changed.filter((c) => c.b.commissionDate && c.b.commissionDate <= today)
      .length,
    totalBefore: sum(before),
    totalAfter: sum(after.values()),
    rows: changed.slice(0, MAX_ROWS).map(({ b, a }) => ({
      jobId: b.jobId,
      jobName: b.jobNumber ? `${b.jobNumber} · ${b.jobName}` : b.jobName,
      salesperson: b.salesperson,
      status: b.statusLabel,
      before: { ratePct: b.ratePct, commission: b.commission },
      after: { ratePct: a?.ratePct ?? null, commission: a?.commission ?? null },
    })),
    rowsUsingRate: input.rateId ? before.filter((r) => r.rateId === input.rateId).length : 0,
    truncated: changed.length > MAX_ROWS,
  };
}

/**
 * Impact of replacing the active rates with `nextRates` (computed from live JobTread data).
 * `nextRates` receives the current active rates and returns the proposed list.
 */
export async function previewRateImpact(
  ruleSet: RuleSetRow,
  nextRates: (current: StoredRate[]) => RateRow[],
  rateId?: string | null,
): Promise<RateImpact> {
  const [jobs, rates, assignments] = await Promise.all([
    loadCommissionJobs(),
    listRates(ruleSet.id),
    listAssignments(ruleSet.id),
  ]);
  return compareCommissions({
    ruleSet,
    jobs,
    assignments,
    before: rates,
    after: nextRates(rates),
    rateId,
  });
}

/** Short human summary for audit entries and confirmations. */
export function describeImpact(impact: RateImpact): string {
  if (!impact.affectedRows) return "No calculated commissions change.";
  const delta = cents(impact.totalAfter - impact.totalBefore);
  return `${impact.affectedRows} commission row(s) change${
    impact.payableAffected ? ` (${impact.payableAffected} already dated on or before today)` : ""
  }; total ${delta >= 0 ? "+" : "−"}$${Math.abs(delta).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}.`;
}
