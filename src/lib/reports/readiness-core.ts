/**
 * Financial reporting readiness (pure): one state per area, the reason, and where an
 * administrator fixes it. Diagnostics describe the synced data; they never certify that it is
 * complete — Baxter can only see what JobTread returned to its grant.
 */

export const READINESS_STATES = [
  "ready",
  "partially_configured",
  "incomplete_source_data",
  "requires_mapping",
  "sync_disabled",
  "unsupported",
  "requires_migration",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export const READINESS_LABELS: Record<ReadinessState, string> = {
  ready: "Ready",
  partially_configured: "Partially configured",
  incomplete_source_data: "Incomplete source data",
  requires_mapping: "Requires mapping",
  sync_disabled: "Sync disabled",
  unsupported: "Unsupported by JobTread API",
  requires_migration: "Requires database migration",
};

export type ReadinessArea = {
  key:
    | "documents"
    | "invoice_fields"
    | "status_mapping"
    | "payments"
    | "tasks"
    | "project_manager"
    | "pp_mapping"
    | "snapshots"
    | "alerts";
  label: string;
  state: ReadinessState;
  detail: string;
  /** Where an administrator changes it. */
  setting: string;
  metrics: Record<string, number | string | null>;
};

export type EntityStatus = {
  enabled: boolean;
  lastSuccessAt: string | null;
  recordsCached: number | null;
  dropped: string[];
};

export type ReadinessInput = {
  migrated: boolean;
  entities: Partial<Record<"documents" | "payments" | "tasks" | "jobs", EntityStatus>>;
  /** JobTread record counts from the Data Catalog (null when never verified). */
  sourceCounts: Partial<Record<"documents" | "payments" | "tasks", number | null>>;
  documents: {
    total: number;
    invoices: number;
    unmappedStatuses: number;
    unmappedInvoices: number;
  };
  payments: { synced: number; mismatches: number; verifiedInvoices: number; balanceSource: string };
  tasks: { total: number; jobsWithTasks: number; orphaned: number };
  pm: {
    completenessPct: number | null;
    mappingDefect: string | null;
    populated: number;
    total: number;
  };
  pp: {
    configured: boolean;
    classified: number;
    approved: number;
    ambiguous: number;
    unmatched: number;
  };
  snapshots: { enabled: boolean; lastPeriod: string | null; runs: number };
  alerts: { rules: number; enabled: number; invalid: number; open: number };
};

const DS = "Reports → Data settings";

export function computeReadiness(input: ReadinessInput): ReadinessArea[] {
  const e = input.entities;
  const areas: ReadinessArea[] = [];
  const docs = e.documents;
  areas.push({
    key: "documents",
    label: "Financial documents source",
    state: !docs?.lastSuccessAt
      ? docs?.enabled === false
        ? "sync_disabled"
        : "incomplete_source_data"
      : input.documents.invoices === 0
        ? "incomplete_source_data"
        : "ready",
    detail: !docs?.lastSuccessAt
      ? "Financial documents haven't synced successfully yet."
      : `${input.documents.total} documents synced, ${input.documents.invoices} customer invoices.${
          input.sourceCounts.documents !== undefined && input.sourceCounts.documents !== null
            ? ` JobTread reported ${input.sourceCounts.documents} at the last catalog check.`
            : ""
        }`,
    setting: `${DS} → Sync`,
    metrics: { documents: input.documents.total, invoices: input.documents.invoices },
  });
  const dropped = docs?.dropped ?? [];
  areas.push({
    key: "invoice_fields",
    label: "Invoice-level fields",
    state: !input.migrated
      ? "requires_migration"
      : dropped.length
        ? dropped.some((f) => ["amountPaid", "balance"].includes(f))
          ? "unsupported"
          : "partially_configured"
        : docs?.lastSuccessAt
          ? "ready"
          : "incomplete_source_data",
    detail: !input.migrated
      ? "Migration 084 adds customer, updated-at, and document custom field columns."
      : dropped.length
        ? `JobTread doesn't return ${dropped.join(", ")} to Baxter's grant; those fields are hidden.`
        : "All requested invoice attributes are returned by JobTread.",
    setting: `${DS} → Financial data`,
    metrics: { unsupportedAttributes: dropped.length },
  });
  areas.push({
    key: "status_mapping",
    label: "Document status mapping",
    state: !input.migrated
      ? "requires_migration"
      : input.documents.unmappedStatuses === 0 && input.documents.total > 0
        ? "ready"
        : input.documents.unmappedStatuses > 0
          ? "requires_mapping"
          : "incomplete_source_data",
    detail: input.documents.unmappedStatuses
      ? `${input.documents.unmappedStatuses} JobTread status${input.documents.unmappedStatuses === 1 ? "" : "es"} (${input.documents.unmappedInvoices} invoices) aren't mapped to a lifecycle status; they show as Unknown and are left out of totals.`
      : "Every JobTread document status in the data is mapped.",
    setting: `${DS} → Financial data → Status mapping`,
    metrics: {
      unmappedStatuses: input.documents.unmappedStatuses,
      unmappedInvoices: input.documents.unmappedInvoices,
    },
  });
  const pay = e.payments;
  const policyAccepted = input.payments.balanceSource === "jobtread_balance";
  areas.push({
    key: "payments",
    label: "Payments",
    state:
      dropped.includes("amountPaid") || (pay?.dropped ?? []).includes("amount")
        ? "unsupported"
        : !pay?.enabled
          ? policyAccepted
            ? "partially_configured"
            : "sync_disabled"
          : !pay.lastSuccessAt
            ? "incomplete_source_data"
            : input.payments.mismatches > 0
              ? "incomplete_source_data"
              : input.payments.synced === 0 && (input.sourceCounts.payments ?? 0) === 0
                ? "incomplete_source_data"
                : "ready",
    detail: !pay?.enabled
      ? policyAccepted
        ? "Payment sync is off; balances use JobTread's document balance (accepted by an administrator), so payment history isn't available."
        : "Payment sync is off (it ships disabled because payments are financial data). Balances are unverified, overdue amounts show as incomplete, and financial alerts don't fire."
      : !pay.lastSuccessAt
        ? "Payment sync is on but hasn't succeeded yet."
        : input.payments.synced === 0
          ? "Payment sync succeeded but JobTread returned no payment records. Totals that depend on payments stay incomplete until payments are recorded in JobTread."
          : input.payments.mismatches
            ? `${input.payments.mismatches} invoice(s) have payment records that don't match JobTread's amount paid.`
            : `${input.payments.synced} payment records synced; ${input.payments.verifiedInvoices} invoices verified.`,
    setting: `${DS} → Sync (Payments)`,
    metrics: {
      synced: input.payments.synced,
      mismatches: input.payments.mismatches,
      sourceCount: input.sourceCounts.payments ?? null,
    },
  });
  const tasks = e.tasks;
  areas.push({
    key: "tasks",
    label: "Tasks source",
    state: !tasks?.enabled
      ? "sync_disabled"
      : !tasks.lastSuccessAt
        ? "incomplete_source_data"
        : input.tasks.orphaned > 0
          ? "partially_configured"
          : "ready",
    detail: !tasks?.lastSuccessAt
      ? "Tasks haven't synced successfully yet."
      : `${input.tasks.total} tasks on ${input.tasks.jobsWithTasks} jobs.${input.tasks.orphaned ? ` ${input.tasks.orphaned} tasks reference a job that isn't synced.` : ""}`,
    setting: `${DS} → Sync (Tasks & schedule)`,
    metrics: {
      tasks: input.tasks.total,
      jobsWithTasks: input.tasks.jobsWithTasks,
      orphaned: input.tasks.orphaned,
    },
  });
  areas.push({
    key: "project_manager",
    label: "Project Manager",
    state: input.pm.mappingDefect
      ? "requires_mapping"
      : input.pm.completenessPct !== null && input.pm.completenessPct < 100
        ? "incomplete_source_data"
        : input.pm.total
          ? "ready"
          : "incomplete_source_data",
    detail:
      input.pm.mappingDefect ??
      `${input.pm.populated} of ${input.pm.total} jobs have a Project Manager in JobTread${input.pm.completenessPct !== null ? ` (${input.pm.completenessPct}%)` : ""}.`,
    setting: `${DS} → Financial data → Project Manager`,
    metrics: {
      populated: input.pm.populated,
      total: input.pm.total,
      completenessPct: input.pm.completenessPct,
    },
  });
  areas.push({
    key: "pp_mapping",
    label: "PP# milestone mapping",
    state: !input.migrated
      ? "requires_migration"
      : !input.pp.configured
        ? "requires_mapping"
        : input.pp.approved === 0 || input.pp.ambiguous || input.pp.unmatched
          ? "partially_configured"
          : "ready",
    detail: !input.pp.configured
      ? "No PP# rule is configured yet; PP# fields stay blank and the milestone drill level is off."
      : `${input.pp.classified} PP# invoices; ${input.pp.approved} links approved, ${input.pp.ambiguous} ambiguous, ${input.pp.unmatched} unmatched.`,
    setting: `${DS} → Financial data → PP# mapping`,
    metrics: { ...input.pp, configured: input.pp.configured ? "yes" : "no" },
  });
  areas.push({
    key: "snapshots",
    label: "Weekly snapshots",
    state: !input.migrated
      ? "requires_migration"
      : !input.snapshots.enabled
        ? "partially_configured"
        : input.snapshots.runs === 0
          ? "incomplete_source_data"
          : "ready",
    detail: !input.snapshots.enabled
      ? "Snapshots are off. Turn them on to start weekly history (collection starts from the next scheduled day; past weeks are never filled in)."
      : input.snapshots.lastPeriod
        ? `Last snapshot: week of ${input.snapshots.lastPeriod}.`
        : "On; the first snapshot will be taken at the next scheduled time.",
    setting: `${DS} → Financial data → Snapshots`,
    metrics: { runs: input.snapshots.runs, lastPeriod: input.snapshots.lastPeriod },
  });
  areas.push({
    key: "alerts",
    label: "Alerts",
    state: !input.migrated
      ? "requires_migration"
      : input.alerts.enabled === 0
        ? "partially_configured"
        : input.alerts.invalid
          ? "requires_mapping"
          : "ready",
    detail:
      input.alerts.rules === 0
        ? "No alert rules yet. Nothing is sent until an administrator configures a rule and its recipients."
        : `${input.alerts.enabled} of ${input.alerts.rules} rules enabled${input.alerts.invalid ? `, ${input.alerts.invalid} need settings` : ""}; ${input.alerts.open} open alerts.`,
    setting: `${DS} → Financial data → Alerts`,
    metrics: { ...input.alerts },
  });
  return areas;
}

export type Diagnostic = { key: string; label: string; count: number; detail: string };

/**
 * Historical-data diagnostics over the synced documents: patterns that usually mean records
 * were migrated into JobTread or entered incompletely. Counts only — never a completeness claim.
 */
export function historicalDiagnostics(input: {
  invoices: Array<{
    job_id: string | null;
    issue_date: string | null;
    due_date: string | null;
    price: unknown;
    balance: unknown;
    amount_paid: unknown;
    source_created_at?: string | null;
  }>;
  payments: Array<{ document_id: string | null; job_id: string | null }>;
  documentIds: Set<string>;
  jobIds: Set<string>;
}): { diagnostics: Diagnostic[]; disclaimer: string } {
  const inv = input.invoices;
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  const backdated = inv.filter(
    (d) =>
      d.issue_date &&
      d.source_created_at &&
      d.source_created_at.slice(0, 10) > d.issue_date &&
      daysApart(d.issue_date, d.source_created_at.slice(0, 10)) > 30,
  ).length;
  const list: Diagnostic[] = [
    {
      key: "no_job",
      label: "Invoices without a job",
      count: inv.filter((d) => !d.job_id).length,
      detail: "Can't be joined to a project, PM, or milestone.",
    },
    {
      key: "job_not_synced",
      label: "Invoices on a job that isn't synced",
      count: inv.filter((d) => d.job_id && !input.jobIds.has(d.job_id)).length,
      detail: "The job may be archived or outside the grant.",
    },
    {
      key: "no_issue_date",
      label: "Invoices without an issue date",
      count: inv.filter((d) => !d.issue_date).length,
      detail: "Can't be placed in a period.",
    },
    {
      key: "no_due_date",
      label: "Invoices without a due date",
      count: inv.filter((d) => !d.due_date).length,
      detail: "Can never be called overdue.",
    },
    {
      key: "blank_amounts",
      label: "Invoices with blank amounts",
      count: inv.filter((d) => blank(d.price) || blank(d.balance) || blank(d.amount_paid)).length,
      detail: "Totals that include them are incomplete.",
    },
    {
      key: "backdated",
      label: "Invoices entered 30+ days after their issue date",
      count: backdated,
      detail:
        "Often historical invoices migrated into JobTread; their payments may not have been migrated.",
    },
    {
      key: "payment_no_document",
      label: "Payments not linked to a document",
      count: input.payments.filter((p) => !p.document_id).length,
      detail: "Can't verify any invoice balance.",
    },
    {
      key: "payment_unknown_document",
      label: "Payments on a document that isn't synced",
      count: input.payments.filter((p) => p.document_id && !input.documentIds.has(p.document_id))
        .length,
      detail: "The document may be outside the grant or removed.",
    },
  ];
  return {
    diagnostics: list,
    disclaimer:
      "These checks describe the data JobTread returned to Baxter. They can't prove it's complete: records JobTread never had, or that the grant can't see, don't appear here.",
  };
}

function daysApart(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
