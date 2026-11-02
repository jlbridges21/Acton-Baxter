/**
 * Invoice-level financials from JobTread documents and payments (pure, deterministic).
 *
 * Two statuses are kept apart on purpose:
 *   lifecycle — what the document *is* in its workflow (Draft, Issued, Voided, …). It comes only
 *               from the administrator's mapping of JobTread's raw type + status; unmapped
 *               statuses are "unknown", never guessed.
 *   payment   — how much of it is paid, from JobTread's amountPaid / balance.
 *
 * A balance is only *verified* when the configured policy says so:
 *   payments_reconciled — JobTread's amountPaid agrees with the synced payment records
 *   jobtread_balance    — an administrator accepted JobTread's document balance as-is
 * Overdue needs a verified unpaid balance. When payment data is missing, totals are marked
 * incomplete — never shown as zero.
 */

export const LIFECYCLE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "voided",
  "unknown",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially Paid",
  paid: "Paid",
  voided: "Voided",
  unknown: "Unknown",
};

export type PaymentStatus =
  "unpaid" | "partially_paid" | "paid" | "overpaid" | "unknown" | "not_applicable";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  overpaid: "Overpaid",
  unknown: "Unknown (no amounts from JobTread)",
  not_applicable: "Not an invoice",
};

export type BalanceVerification =
  | "verified" // payments reconcile with JobTread's amount paid
  | "accepted" // admin policy accepts JobTread's balance
  | "mismatch" // payment records disagree with JobTread's amount paid
  | "unverified" // payments aren't synced (or never succeeded)
  | "not_applicable";

export const VERIFICATION_LABELS: Record<BalanceVerification, string> = {
  verified: "Verified against payments",
  accepted: "JobTread balance (accepted by admin)",
  mismatch: "Payments don't match JobTread",
  unverified: "Unverified (payments not synced)",
  not_applicable: "Not an invoice",
};

export type StatusMapEntry = { type: string; status: string; lifecycle: LifecycleStatus };

export type FinancialSettings = {
  statusMap: StatusMapEntry[];
  balanceSource: "payments_reconciled" | "jobtread_balance";
  overdueGraceDays: number;
};

export const DEFAULT_FINANCIAL_SETTINGS: FinancialSettings = {
  statusMap: [],
  balanceSource: "payments_reconciled",
  overdueGraceDays: 0,
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  customerInvoice: "Customer invoice",
  customerOrder: "Customer order",
  vendorBill: "Vendor bill",
  vendorOrder: "Vendor order",
};

export type FinancialDocumentRow = {
  id: string;
  job_id: string | null;
  type: string;
  status: string | null;
  number: string | null;
  name: string | null;
  issue_date: string | null;
  due_date: string | null;
  signed_at?: string | null;
  price: number | string | null;
  cost: number | string | null;
  tax: number | string | null;
  amount_paid: number | string | null;
  balance: number | string | null;
  source_created_at?: string | null;
  source_updated_at?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  fields?: Record<string, string[]> | null;
  synced_at?: string | null;
};

export type PaymentRow = {
  id: string;
  job_id: string | null;
  document_id: string | null;
  amount: number | string | null;
  paid_on: string | null;
  payment_type?: string | null;
  account_id?: string | null;
  source_created_at?: string | null;
  synced_at?: string | null;
};

/** What Baxter knows about the payments dataset (Sync Manager state). */
export type PaymentsState = {
  enabled: boolean;
  lastSucceededAt: string | null;
  /** JobTread's own count of payment records (Data Catalog), when verified. */
  sourceCount: number | null;
};

const CENT = 0.005;

export const toNum = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
export const round2 = (n: number) => Math.round(n * 100) / 100;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Lifecycle from the admin mapping; "unknown" when the raw status isn't mapped. */
export function mapLifecycle(
  doc: Pick<FinancialDocumentRow, "type" | "status">,
  statusMap: StatusMapEntry[],
): LifecycleStatus {
  const hit = statusMap.find(
    (m) => m.type === doc.type && norm(m.status) === norm(doc.status ?? ""),
  );
  return hit?.lifecycle ?? "unknown";
}

/** Every raw (type, status) pair in the data, with its count and current mapping. */
export function statusInventory(
  docs: Array<Pick<FinancialDocumentRow, "type" | "status">>,
  statusMap: StatusMapEntry[],
) {
  const counts = new Map<string, { type: string; status: string; count: number }>();
  for (const d of docs) {
    const status = d.status ?? "";
    const key = `${d.type}|${norm(status)}`;
    const hit = counts.get(key) ?? { type: d.type, status, count: 0 };
    hit.count++;
    counts.set(key, hit);
  }
  return [...counts.values()]
    .map((c) => ({ ...c, lifecycle: mapLifecycle(c, statusMap) }))
    .sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count);
}

/** Document total: price + tax. Blank when either is blank (never assumed to be zero). */
export function documentTotal(doc: Pick<FinancialDocumentRow, "price" | "tax">): number | null {
  const price = toNum(doc.price);
  const tax = toNum(doc.tax);
  return price === null || tax === null ? null : round2(price + tax);
}

export function paymentStatusOf(
  doc: Pick<FinancialDocumentRow, "type" | "amount_paid" | "balance">,
): PaymentStatus {
  if (doc.type !== "customerInvoice") return "not_applicable";
  const paid = toNum(doc.amount_paid);
  const balance = toNum(doc.balance);
  if (paid === null || balance === null) return "unknown";
  if (balance < -CENT) return "overpaid";
  if (balance <= CENT) return paid > CENT ? "paid" : "unknown";
  return paid > CENT ? "partially_paid" : "unpaid";
}

/** Payment kind: refunds and reversals stay their own rows (negative amounts or typed). */
export function paymentKind(p: Pick<PaymentRow, "amount" | "payment_type">) {
  const type = norm(p.payment_type);
  if (/revers|void|chargeback/.test(type)) return "reversal" as const;
  if (/refund/.test(type)) return "refund" as const;
  const amount = toNum(p.amount);
  if (amount !== null && amount < 0) return "refund" as const;
  return "payment" as const;
}

/**
 * Signed amount a payment contributes. JobTread may report refunds as negative amounts or as
 * a typed positive amount; either way a refund reduces what was collected (counted once).
 */
export function signedPaymentAmount(p: Pick<PaymentRow, "amount" | "payment_type">) {
  const amount = toNum(p.amount);
  if (amount === null) return null;
  return paymentKind(p) === "payment" ? amount : -Math.abs(amount);
}

/**
 * Payment rows by document, keyed by JobTread payment id (a resync never duplicates). Rows
 * with the same document, amount, and date under different ids are flagged, not dropped —
 * JobTread allows two identical payments on one day.
 */
export function indexPayments(payments: PaymentRow[]) {
  const byId = new Map<string, PaymentRow>();
  for (const p of payments) byId.set(p.id, p);
  const byDocument = new Map<string, PaymentRow[]>();
  const signature = new Map<string, string[]>();
  for (const p of byId.values()) {
    if (p.document_id) byDocument.set(p.document_id, [...(byDocument.get(p.document_id) ?? []), p]);
    const sig = `${p.document_id ?? ""}|${toNum(p.amount)}|${p.paid_on ?? ""}`;
    signature.set(sig, [...(signature.get(sig) ?? []), p.id]);
  }
  const possibleDuplicates = new Set<string>();
  for (const ids of signature.values())
    if (ids.length > 1) ids.forEach((i) => possibleDuplicates.add(i));
  return { byId, byDocument, possibleDuplicates };
}

export type InvoiceFacts = {
  lifecycle: LifecycleStatus;
  paymentStatus: PaymentStatus;
  verification: BalanceVerification;
  total: number | null;
  amountPaid: number | null;
  balance: number | null;
  paymentsTotal: number | null;
  paymentCount: number;
  refundTotal: number | null;
  lastPaymentDate: string | null;
  daysPastDue: number | null;
  /** true/false only for a verified balance; null when it can't be known. */
  overdue: boolean | null;
  /** Lifecycle says one thing and the amounts another (e.g. mapped Paid with a balance). */
  conflict: string | null;
};

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function invoiceFacts(
  doc: FinancialDocumentRow,
  payments: PaymentRow[],
  settings: FinancialSettings,
  paymentsState: PaymentsState,
  today: string,
): InvoiceFacts {
  const lifecycle = mapLifecycle(doc, settings.statusMap);
  const paymentStatus = paymentStatusOf(doc);
  const amountPaid = toNum(doc.amount_paid);
  const balance = toNum(doc.balance);
  const isInvoice = doc.type === "customerInvoice";
  const signed = payments.map(signedPaymentAmount);
  const paymentsTotal =
    paymentsState.enabled && paymentsState.lastSucceededAt
      ? round2(signed.reduce<number>((s, v) => s + (v ?? 0), 0))
      : null;
  const refunds = payments.filter((p) => paymentKind(p) !== "payment");
  let verification: BalanceVerification = "not_applicable";
  if (isInvoice) {
    if (settings.balanceSource === "jobtread_balance")
      verification = balance === null ? "unverified" : "accepted";
    else if (!paymentsState.enabled || !paymentsState.lastSucceededAt || paymentsTotal === null)
      verification = "unverified";
    else if (amountPaid === null || balance === null || signed.some((v) => v === null))
      verification = "unverified";
    else verification = Math.abs(paymentsTotal - amountPaid) <= CENT ? "verified" : "mismatch";
  }
  const balanceVerified = verification === "verified" || verification === "accepted";
  const open = lifecycle === "issued" || lifecycle === "partially_paid";
  const daysPastDue =
    isInvoice && doc.due_date && open && (balance ?? 0) > CENT
      ? daysBetween(doc.due_date, today)
      : null;
  let overdue: boolean | null = null;
  if (isInvoice) {
    if (lifecycle === "draft" || lifecycle === "voided" || lifecycle === "paid") overdue = false;
    else if (lifecycle === "unknown") overdue = null;
    else if (!balanceVerified || balance === null) overdue = null;
    else if (balance <= CENT || !doc.due_date) overdue = false;
    else overdue = daysBetween(doc.due_date, today) > settings.overdueGraceDays;
  }
  let conflict: string | null = null;
  if (
    isInvoice &&
    lifecycle === "paid" &&
    (paymentStatus === "unpaid" || paymentStatus === "partially_paid")
  )
    conflict = `Mapped as Paid, but JobTread shows a balance of ${balance}.`;
  else if (isInvoice && lifecycle === "draft" && (amountPaid ?? 0) > CENT)
    conflict = "Mapped as Draft, but JobTread shows money paid on it.";
  const dates = payments
    .map((p) => p.paid_on)
    .filter((d): d is string => Boolean(d))
    .sort();
  return {
    lifecycle,
    paymentStatus,
    verification,
    total: documentTotal(doc),
    amountPaid,
    balance,
    paymentsTotal,
    paymentCount: payments.length,
    refundTotal: refunds.length
      ? round2(refunds.reduce((s, p) => s + Math.abs(toNum(p.amount) ?? 0), 0))
      : paymentsTotal === null
        ? null
        : 0,
    lastPaymentDate: dates.at(-1) ?? null,
    daysPastDue,
    overdue,
    conflict,
  };
}

export type Completeness = "complete" | "partial" | "incomplete";

export type ReconciliationTotals = {
  invoiceCount: number;
  /** Issued invoices (lifecycle issued / partially paid / paid). */
  countedInvoices: number;
  invoiced: number | null;
  paid: number | null;
  outstanding: number | null;
  overdue: number | null;
  overdueCount: number | null;
  /** Sum of synced payment records (signed: refunds reduce it). */
  paymentsCollected: number | null;
  completeness: Completeness;
  reasons: string[];
};

/**
 * Totals across invoices without double counting: invoiced/paid/outstanding come from the
 * documents (JobTread's own amounts); payment records are only used to verify them and are
 * never added on top. Unmapped statuses, blank amounts, and unverified balances make the
 * result partial or incomplete with the reasons listed.
 */
export function reconcileInvoices(
  invoices: Array<{ doc: FinancialDocumentRow; facts: InvoiceFacts }>,
  paymentsState: PaymentsState,
  settings: FinancialSettings,
): ReconciliationTotals {
  const reasons: string[] = [];
  const only = invoices.filter((i) => i.doc.type === "customerInvoice");
  const counted = only.filter((i) =>
    ["issued", "partially_paid", "paid"].includes(i.facts.lifecycle),
  );
  const unknown = only.filter((i) => i.facts.lifecycle === "unknown").length;
  if (unknown)
    reasons.push(
      `${unknown} invoice${unknown === 1 ? " has" : "s have"} a JobTread status that isn't mapped yet (Reports → Data settings → Financial data → Status mapping).`,
    );
  const sum = (vals: Array<number | null>) =>
    vals.some((v) => v === null) ? null : round2(vals.reduce<number>((s, v) => s + (v ?? 0), 0));
  const invoiced = sum(counted.map((i) => i.facts.total));
  const paid = sum(counted.map((i) => i.facts.amountPaid));
  const outstanding = sum(counted.map((i) => i.facts.balance));
  if (counted.length && (invoiced === null || paid === null || outstanding === null))
    reasons.push("Some issued invoices have blank amounts in JobTread, so totals are incomplete.");
  const unverified = counted.filter(
    (i) => i.facts.verification !== "verified" && i.facts.verification !== "accepted",
  );
  const mismatched = counted.filter((i) => i.facts.verification === "mismatch").length;
  if (mismatched)
    reasons.push(
      `${mismatched} invoice${mismatched === 1 ? "'s" : "s'"} payment records don't match JobTread's amount paid.`,
    );
  if (settings.balanceSource === "payments_reconciled" && !paymentsState.enabled)
    reasons.push(
      "Payment sync is turned off, so paid and outstanding balances aren't verified (Reports → Data settings → Sync).",
    );
  else if (settings.balanceSource === "payments_reconciled" && !paymentsState.lastSucceededAt)
    reasons.push("Payments haven't synced successfully yet, so balances aren't verified.");
  // An unmapped invoice could be overdue, so overdue is unknown (not $0) until it's mapped.
  const overdueKnown = unknown === 0 && counted.every((i) => i.facts.overdue !== null);
  const overdueRows = counted.filter((i) => i.facts.overdue === true);
  const overdue = overdueKnown ? sum(overdueRows.map((i) => i.facts.balance)) : null;
  const collected =
    paymentsState.enabled && paymentsState.lastSucceededAt
      ? sum(counted.map((i) => i.facts.paymentsTotal))
      : null;
  const completeness: Completeness =
    unverified.length === 0 && !unknown && invoiced !== null
      ? "complete"
      : counted.length && invoiced !== null
        ? "partial"
        : "incomplete";
  return {
    invoiceCount: only.length,
    countedInvoices: counted.length,
    invoiced: counted.length ? invoiced : unknown ? null : 0,
    paid,
    outstanding,
    overdue,
    overdueCount: overdueKnown ? overdueRows.length : null,
    paymentsCollected: collected,
    completeness,
    reasons,
  };
}
